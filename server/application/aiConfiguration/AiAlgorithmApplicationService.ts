import type { AiAlgorithmStepParameters } from '../../../shared/schemas/aiConfiguration'
import type { AiAlgorithmCode } from '../../../shared/types/aiConfiguration'
import type { AiAlgorithmSnapshot, AiAlgorithmStepSnapshot } from '../../domain/ai/AiAlgorithmModels'
import { getAiAlgorithmDefinition } from '../../domain/ai/AiAlgorithmDefinitions'
import type { AiConfigurationRepository, AiConnectionSecretRecord } from '../../ports/AiConfigurationRepository'
import type { AiModelFactory } from '../../ports/AiModelFactory'
import type { SecretCipher } from '../../ports/SecretCipher'
import type { TextModelResponse } from '../../ports/TextModelPort'
import { TextModelError } from '../../ports/TextModelPort'
import type { AiPromptApplicationService } from '../aiPrompts/AiPromptApplicationService'
import { ApplicationError } from '../errors/ApplicationError'
import { connectionSecretContext } from './AiConfigurationApplicationService'

/** 管理员测试单个步骤时返回的只读执行事实。 */
export interface AiAlgorithmTestStepExecution {
  /** 实际执行的步骤快照。 */
  step: AiAlgorithmStepSnapshot
  /** 实际使用草稿或已发布提示词。 */
  prompt: Awaited<ReturnType<AiPromptApplicationService['renderDraftPreferred']>>
  /** 成功时的模型结果；失败时为空。 */
  response: TextModelResponse | null
  /** 供应商返回的原始消息正文；调用前失败时为空。 */
  rawOutput: string | null
  /** 模型调用耗时。 */
  durationMs: number
  /** 已脱敏模型错误；成功时为空。 */
  error: string | null
}

/** 算法步骤参数之外由代码固定的安全预算。 */
const ALGORITHM_PARAMETER_DEFAULTS = {
  maxEvidenceChunks: 50,
  maxTextBlocks: 1,
  maxImageBlocks: 0,
  maxPromptCharacters: 160_000,
  maxTotalTokens: 32_000,
  maxBlockAttempts: 1,
  contextWindowTokens: 64_000,
  reservedOutputTokens: 8_192,
  safetyMarginTokens: 2_048,
  worldBudgetTokens: 5_000,
  worldSoulBudgetTokens: 2_500,
  worldGrowthBudgetTokens: 2_500,
  personaBudgetTokens: 9_000,
  personaSoulBudgetTokens: 3_500,
  personaGrowthBudgetTokens: 2_500,
  personaMemoryBudgetTokens: 3_000,
  sourceBudgetTokens: 5_000,
} as const

/** AI 算法准备与执行服务依赖。 */
export interface AiAlgorithmApplicationServiceDependencies {
  /** AI 连接、模型部署和算法配置事实源。 */
  repository: AiConfigurationRepository
  /** 版本化提示词渲染服务。 */
  prompts: Pick<AiPromptApplicationService, 'render' | 'renderDraftPreferred' | 'snapshotPublishedVersions'>
  /** 只在执行期间解密凭据的端口。 */
  secretCipher: SecretCipher
  /** 动态模型适配器工厂。 */
  modelFactory: AiModelFactory
}

/** 按固定代码流程准备不可变快照，并通过数据库选择的不同端点执行步骤。 */
export class AiAlgorithmApplicationService {
  /** @param dependencies 配置仓储、提示词、加密器和模型工厂。 */
  constructor(private readonly dependencies: AiAlgorithmApplicationServiceDependencies) {}

  /**
   * 固定一次新任务使用的实现、配置、模型、提示词和参数。
   * @param code 固定算法编码。
   * @returns 不含任何访问凭据的完整算法快照。
   */
  async prepare(code: AiAlgorithmCode): Promise<AiAlgorithmSnapshot> {
    const definition = getAiAlgorithmDefinition(code)
    const configuration = await this.dependencies.repository.findActiveAlgorithmConfiguration(code)
    if (!configuration) throw new ApplicationError('AI_ALGORITHM_NOT_CONFIGURED', `算法“${definition.name}”尚未配置`, 422)
    if (configuration.steps.length !== definition.steps.length) {
      throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_INVALID', `算法“${definition.name}”的步骤配置不完整`, 409)
    }
    const promptVersions = await this.dependencies.prompts.snapshotPublishedVersions(
      definition.steps.map(step => step.promptCode),
    )
    const steps = await Promise.all(definition.steps.map(async (definitionStep) => {
      const configuredStep = configuration.steps.find(step => step.stepKey === definitionStep.key)
      if (!configuredStep || configuredStep.promptCode !== definitionStep.promptCode
        || configuredStep.ordinal !== definitionStep.ordinal) {
        throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_INVALID', `算法步骤“${definitionStep.name}”配置与代码不一致`, 409)
      }
      const deployment = await this.requireTextDeployment(configuredStep.modelDeploymentId)
      const connection = await this.requireEnabledConnection(deployment.connectionId)
      return {
        stepKey: definitionStep.key,
        ordinal: definitionStep.ordinal,
        modelDeploymentId: deployment.id,
        connectionId: connection.id,
        protocol: connection.protocol,
        endpoint: connection.endpoint,
        userAgent: connection.userAgent,
        model: deployment.model,
        promptCode: definitionStep.promptCode,
        promptVersionId: promptVersions[definitionStep.promptCode]!,
        parameters: configuredStep.parameters,
      }
    }))
    return {
      algorithmCode: code,
      implementationVersion: definition.implementationVersion,
      configurationVersionId: configuration.id,
      configurationVersion: configuration.versionNo,
      steps,
    }
  }

  /**
   * 使用已固定快照执行一个步骤，并拒绝连接或模型被编辑后的隐式漂移。
   * @param snapshot 创建任务时保存的非敏感算法快照。
   * @param stepKey 待执行的固定步骤标识。
   * @param variables 提示词模板的完整变量。
   * @param responseSchemaName 供应商诊断使用的结构名称。
   * @param responseFormat JSON 对象或纯文本输出。
   * @returns 模型输出和用量。
   */
  async executeStep(
    snapshot: AiAlgorithmSnapshot,
    stepKey: string,
    variables: Record<string, string>,
    responseSchemaName: string,
    responseFormat: 'json_object' | 'text',
  ): Promise<TextModelResponse> {
    const { step, connection } = await this.resolveStep(snapshot, stepKey)
    const prompt = await this.dependencies.prompts.render(step.promptCode, variables, step.promptVersionId)
    this.validatePromptLength(prompt.systemPrompt, prompt.userPrompt)
    return await this.generate(step, connection, prompt, responseSchemaName, responseFormat)
  }

  /**
   * 使用当前草稿优先策略真实测试一个步骤，并返回诊断所需的完整只读事实。
   * @param snapshot 本次测试固定的已发布算法配置快照。
   * @param stepKey 待测试的固定步骤标识。
   * @param variables 提示词模板的完整变量。
   * @param responseSchemaName 供应商诊断使用的结构名称。
   * @param responseFormat JSON 对象或纯文本输出。
   * @returns 实际提示词、模型响应、耗时或已脱敏模型错误。
   * @remarks 该方法不会创建任务、分析批次或任何业务数据。
   */
  async executeTestStep(
    snapshot: AiAlgorithmSnapshot,
    stepKey: string,
    variables: Record<string, string>,
    responseSchemaName: string,
    responseFormat: 'json_object' | 'text',
  ): Promise<AiAlgorithmTestStepExecution> {
    const { step, connection } = await this.resolveStep(snapshot, stepKey)
    const prompt = await this.dependencies.prompts.renderDraftPreferred(step.promptCode, variables)
    this.validatePromptLength(prompt.systemPrompt, prompt.userPrompt)
    const startedAt = performance.now()
    try {
      const response = await this.generate(step, connection, prompt, responseSchemaName, responseFormat)
      return {
        step,
        prompt,
        response,
        rawOutput: response.rawOutput ?? null,
        durationMs: Math.round(performance.now() - startedAt),
        error: null,
      }
    }
    catch (error: unknown) {
      return {
        step,
        prompt,
        response: null,
        rawOutput: error instanceof TextModelError ? error.rawOutput ?? null : null,
        durationMs: Math.round(performance.now() - startedAt),
        error: normalizeTestExecutionError(error),
      }
    }
  }

  /**
   * 校验算法实现与步骤快照，并拒绝接口或模型配置漂移。
   * @param snapshot 创建任务或测试时固定的算法快照。
   * @param stepKey 待解析的固定步骤标识。
   * @returns 已校验步骤和当前启用连接。
   */
  private async resolveStep(snapshot: AiAlgorithmSnapshot, stepKey: string) {
    const definition = getAiAlgorithmDefinition(snapshot.algorithmCode)
    if (snapshot.implementationVersion !== definition.implementationVersion) {
      throw new ApplicationError('AI_ALGORITHM_VERSION_MISMATCH', '算法实现版本已变化，不能继续执行旧任务', 409)
    }
    const step = snapshot.steps.find(item => item.stepKey === stepKey)
    if (!step) throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_INVALID', '算法步骤快照不存在', 409)
    const stepDefinition = definition.steps.find(item => item.key === stepKey)
    if (!stepDefinition || step.promptCode !== stepDefinition.promptCode || step.ordinal !== stepDefinition.ordinal) {
      throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_INVALID', '算法步骤快照与代码定义不一致', 409)
    }
    const deployment = await this.requireTextDeployment(step.modelDeploymentId)
    const connection = await this.requireEnabledConnection(step.connectionId)
    if (deployment.connectionId !== step.connectionId || deployment.model !== step.model
      || connection.endpoint !== step.endpoint || connection.protocol !== step.protocol
      || connection.userAgent !== (step.userAgent ?? '')) {
      throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_CHANGED', '算法使用的接口或模型已被编辑，请重新创建任务', 409)
    }
    return { step, connection }
  }

  /**
   * 使用已校验连接临时解密密钥并执行模型调用。
   * @param step 已校验的算法步骤快照。
   * @param connection 已校验且启用的连接记录。
   * @param prompt 已完成变量替换的系统与用户提示词。
   * @param responseSchemaName 供应商诊断使用的结构名称。
   * @param responseFormat JSON 对象或纯文本输出。
   * @returns 模型输出和用量。
   */
  private async generate(
    step: AiAlgorithmStepSnapshot,
    connection: AiConnectionSecretRecord,
    prompt: { systemPrompt: string, userPrompt: string },
    responseSchemaName: string,
    responseFormat: 'json_object' | 'text',
  ): Promise<TextModelResponse> {
    const model = this.dependencies.modelFactory.createTextModel({
      endpoint: connection.endpoint,
      apiKey: this.dependencies.secretCipher.decrypt(connection.apiKeyCiphertext, connectionSecretContext(connection.id)),
      model: step.model,
      userAgent: step.userAgent ?? '',
    })
    return await model.generateStructured({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      parameters: buildTextModelParameters(step.parameters),
      responseSchemaName,
      responseFormat,
    })
  }

  /**
   * 拒绝超过固定字符预算的实际提示词。
   * @param systemPrompt 实际系统提示词。
   * @param userPrompt 实际用户提示词。
   * @returns 长度有效时无返回值。
   */
  private validatePromptLength(systemPrompt: string, userPrompt: string): void {
    if (systemPrompt.length + userPrompt.length > ALGORITHM_PARAMETER_DEFAULTS.maxPromptCharacters) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '算法输入超过固定提示长度限制，请减少资料或分批处理', 422)
    }
  }

  /** @param id 模型部署 UUID。 @returns 已启用的文本模型部署。 */
  private async requireTextDeployment(id: string) {
    const deployment = await this.dependencies.repository.findModelDeployment(id)
    if (!deployment || !deployment.isEnabled || deployment.modality !== 'text') {
      throw new ApplicationError('CAPABILITY_DISABLED', '算法绑定的文本模型部署不存在或未启用', 422)
    }
    return deployment
  }

  /** @param id 连接 UUID。 @returns 已启用且含密文的连接。 */
  private async requireEnabledConnection(id: string) {
    const connection = await this.dependencies.repository.findConnection(id)
    if (!connection || !connection.isEnabled) {
      throw new ApplicationError('CAPABILITY_DISABLED', '算法绑定的 AI 接口连接不存在或未启用', 422)
    }
    return connection
  }
}

/**
 * 合并管理员可调步骤参数与代码固定安全预算。
 * @param parameters 当前配置版本固定的三个模型参数。
 * @returns 文本模型端口要求的完整参数。
 */
function buildTextModelParameters(parameters: AiAlgorithmStepParameters) {
  return { ...ALGORITHM_PARAMETER_DEFAULTS, ...parameters }
}

/**
 * 把测试模型异常限制为应用层或模型端口已经脱敏的消息。
 * @param error 模型创建、密钥解密或供应商调用抛出的未知异常。
 * @returns 可安全返回管理员界面的中文错误。
 */
function normalizeTestExecutionError(error: unknown): string {
  if (error instanceof ApplicationError || error instanceof TextModelError) return error.message
  return '模型调用失败，请检查接口凭据和服务状态'
}
