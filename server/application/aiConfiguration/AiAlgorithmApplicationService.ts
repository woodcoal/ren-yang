import type { AiAlgorithmStepParameters } from '../../../shared/schemas/aiConfiguration'
import type { AiAlgorithmCode } from '../../../shared/types/aiConfiguration'
import type { AiAlgorithmSnapshot, AiAlgorithmStepSnapshot } from '../../domain/ai/AiAlgorithmModels'
import { getAiAlgorithmDefinition } from '../../domain/ai/AiAlgorithmDefinitions'
import type { AiConfigurationRepository, AiConnectionSecretRecord } from '../../ports/AiConfigurationRepository'
import type { AiModelFactory } from '../../ports/AiModelFactory'
import type { SecretCipher } from '../../ports/SecretCipher'
import type { SystemAiSettingsRepository } from '../../ports/SystemAiSettingsRepository'
import type { TextModelResponse } from '../../ports/TextModelPort'
import { TextModelError } from '../../ports/TextModelPort'
import type { ImageModelResponse, ImageModelRequest } from '../../ports/ImageModelPort'
import type { AiPromptApplicationService } from '../aiPrompts/AiPromptApplicationService'
import { ApplicationError } from '../errors/ApplicationError'
import { connectionSecretContext } from './AiConfigurationApplicationService'
import {
  AiCacheAffinityScheduler,
  buildAiCacheAffinityKey,
} from './AiCacheAffinityScheduler'

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
  /** 未显式绑定步骤模型时使用的全站默认模型事实源。 */
  defaultModels: Pick<SystemAiSettingsRepository, 'find'>
  /** 版本化提示词渲染服务。 */
  prompts: Pick<AiPromptApplicationService, 'render' | 'renderDraftPreferred' | 'snapshotPublishedVersions'>
  /** 只在执行期间解密凭据的端口。 */
  secretCipher: SecretCipher
  /** 动态模型适配器工厂。 */
  modelFactory: AiModelFactory
  /** 进程内文本模型缓存亲和调度器；默认由服务独占创建。 */
  cacheAffinityScheduler?: Pick<AiCacheAffinityScheduler, 'run'>
}

/** 按固定代码流程准备不可变快照，并通过数据库选择的不同端点执行步骤。 */
export class AiAlgorithmApplicationService {
  /** 当前服务实例共享的进程内缓存亲和调度器。 */
  private readonly cacheAffinityScheduler: Pick<AiCacheAffinityScheduler, 'run'>

  /** @param dependencies 配置仓储、提示词、加密器、模型工厂和可选测试调度器。 */
  constructor(private readonly dependencies: AiAlgorithmApplicationServiceDependencies) {
    this.cacheAffinityScheduler = dependencies.cacheAffinityScheduler ?? new AiCacheAffinityScheduler()
  }

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
    const defaultModels = await this.dependencies.defaultModels.find()
    const steps = await Promise.all(definition.steps.map(async (definitionStep) => {
      const configuredStep = configuration.steps.find(step => step.stepKey === definitionStep.key)
      if (!configuredStep || configuredStep.promptCode !== definitionStep.promptCode
        || configuredStep.ordinal !== definitionStep.ordinal) {
        throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_INVALID', `算法步骤“${definitionStep.name}”配置与代码不一致`, 409)
      }
      const defaultDeploymentId = definitionStep.modality === 'text'
        ? defaultModels?.values.textModelDeploymentId
        : defaultModels?.values.imageModelDeploymentId
      const deploymentId = configuredStep.modelDeploymentId || defaultDeploymentId
      if (!deploymentId) {
        throw new ApplicationError(
          'CAPABILITY_DISABLED',
          `算法步骤“${definitionStep.name}”未绑定模型，且未配置默认${definitionStep.modality === 'text' ? '文本' : '图片'}模型`,
          422,
        )
      }
      const deployment = await this.requireDeployment(deploymentId, definitionStep.modality)
      const connection = await this.requireEnabledConnection(deployment.connectionId)
      const thinkingDisableMode = definitionStep.modality === 'text' && configuredStep.parameters.disableThinking
        ? deployment.thinkingControl
        : 'none'
      if (configuredStep.parameters.disableThinking && thinkingDisableMode === 'none') {
        throw new ApplicationError(
          'AI_THINKING_CONTROL_NOT_CONFIGURED',
          `算法步骤“${definitionStep.name}”要求关闭思考，但当前模型未配置对应请求字段`,
          422,
        )
      }
      return {
        stepKey: definitionStep.key,
        ordinal: definitionStep.ordinal,
        modelDeploymentId: deployment.id,
        connectionId: connection.id,
        protocol: connection.protocol,
        endpoint: connection.endpoint,
        userAgent: connection.userAgent,
        model: deployment.model,
        modality: definitionStep.modality,
        promptCode: definitionStep.promptCode,
        promptVersionId: promptVersions[definitionStep.promptCode]!,
        parameters: resolveStepParameters(configuredStep.parameters, deployment.defaultTimeoutMs),
        thinkingDisableMode,
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
   * @param useCacheAffinity 系统提示词已固定且适合缓存时为 true；默认直接执行。
   * @returns 模型输出和用量。
   */
  async executeStep(
    snapshot: AiAlgorithmSnapshot,
    stepKey: string,
    variables: Record<string, string>,
    responseSchemaName: string,
    responseFormat: 'json_object' | 'text',
    useCacheAffinity = false,
  ): Promise<TextModelResponse> {
    const { step, connection } = await this.resolveStep(snapshot, stepKey, 'text')
    const prompt = await this.dependencies.prompts.render(step.promptCode, variables, step.promptVersionId)
    this.validatePromptLength(prompt.systemPrompt, prompt.userPrompt)
    if (!useCacheAffinity) return await this.generate(step, connection, prompt, responseSchemaName, responseFormat)
    const key = buildAiCacheAffinityKey({
      systemPrompt: prompt.systemPrompt,
      algorithmCode: snapshot.algorithmCode,
      promptVersionId: step.promptVersionId,
      modelDeploymentId: step.modelDeploymentId,
      fixedParameters: {
        ...buildTextModelParameters(step.parameters),
        thinkingDisableMode: step.thinkingDisableMode ?? 'none',
        responseSchemaName,
        responseFormat,
      },
    })
    return await this.cacheAffinityScheduler.run(
      key,
      async () => await this.generate(step, connection, prompt, responseSchemaName, responseFormat, key),
    )
  }


  /**
   * 使用已固定的图片算法步骤生成一张图片，并拒绝接口或模型配置漂移。
   * @param snapshot 调用开始前固定的非敏感算法快照。
   * @param stepKey 待执行的固定图片步骤标识。
   * @param variables 由业务代码组装的完整提示词变量。
   * @param aspectRatio 业务确定的最终图片宽高比。
   * @returns 供应商返回、尚未写入本地存储的图片字节。
   */
  async executeImageStep(
    snapshot: AiAlgorithmSnapshot,
    stepKey: string,
    variables: Record<string, string>,
    aspectRatio: ImageModelRequest['aspectRatio'],
  ): Promise<ImageModelResponse> {
    const { step, connection } = await this.resolveStep(snapshot, stepKey, 'image')
    const prompt = await this.dependencies.prompts.render(step.promptCode, variables, step.promptVersionId)
    this.validatePromptLength(prompt.systemPrompt, prompt.userPrompt)
    const model = this.dependencies.modelFactory.createImageModel({
      endpoint: connection.endpoint,
      apiKey: this.dependencies.secretCipher.decrypt(connection.apiKeyCiphertext, connectionSecretContext(connection.id)),
      model: step.model,
      userAgent: step.userAgent ?? '',
    })
    return await model.generate({
      prompt: [prompt.systemPrompt, prompt.userPrompt].filter(Boolean).join('\n\n'),
      aspectRatio,
      ...(step.parameters.maxImageWidth ? { maxWidth: step.parameters.maxImageWidth } : {}),
      ...(step.parameters.maxImageHeight ? { maxHeight: step.parameters.maxImageHeight } : {}),
      timeoutMs: step.parameters.timeoutMs,
    })
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
    const { step, connection } = await this.resolveStep(snapshot, stepKey, 'text')
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
  private async resolveStep(snapshot: AiAlgorithmSnapshot, stepKey: string, modality: 'text' | 'image') {
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
    if (stepDefinition.modality !== modality || (step.modality ?? 'text') !== modality) {
      throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_INVALID', '算法步骤的模型类型与调用方式不一致', 409)
    }
    const deployment = await this.requireDeployment(step.modelDeploymentId, modality)
    const connection = await this.requireEnabledConnection(step.connectionId)
    if (deployment.connectionId !== step.connectionId || deployment.model !== step.model
      || connection.endpoint !== step.endpoint || connection.protocol !== step.protocol
      || connection.userAgent !== (step.userAgent ?? '')
      || (step.thinkingDisableMode !== undefined && step.thinkingDisableMode !== 'none'
        && step.thinkingDisableMode !== deployment.thinkingControl)) {
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
   * @param promptCacheKey 可选 GPT-5.6 缓存路由键。
   * @returns 模型输出和用量。
   */
  private async generate(
    step: AiAlgorithmStepSnapshot,
    connection: AiConnectionSecretRecord,
    prompt: { systemPrompt: string, userPrompt: string },
    responseSchemaName: string,
    responseFormat: 'json_object' | 'text',
    promptCacheKey?: string,
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
      thinkingDisableMode: step.thinkingDisableMode ?? 'none',
      responseSchemaName,
      responseFormat,
      ...(promptCacheKey ? { promptCacheKey } : {}),
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

  /**
   * 读取类型匹配且已启用的模型部署。
   * @param id 模型部署 UUID。
   * @param modality 算法步骤固定要求的文本或图片类型。
   * @returns 已启用且类型一致的模型部署。
   */
  private async requireDeployment(id: string, modality: 'text' | 'image') {
    const deployment = await this.dependencies.repository.findModelDeployment(id)
    if (!deployment || !deployment.isEnabled || deployment.modality !== modality) {
      throw new ApplicationError('CAPABILITY_DISABLED', `算法绑定的${modality === 'text' ? '文本' : '图片'}模型部署不存在或未启用`, 422)
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
 * 在任务快照创建时把零超时解析为模型部署默认值，避免后续配置变化影响旧任务。
 * @param parameters 当前算法配置版本保存的步骤参数。
 * @param modelDefaultTimeoutMs 当前模型部署的默认请求超时毫秒数。
 * @returns 已固定实际超时的步骤参数副本。
 */
function resolveStepParameters(
  parameters: AiAlgorithmStepParameters,
  modelDefaultTimeoutMs: number,
): AiAlgorithmStepParameters {
  return {
    ...parameters,
    timeoutMs: parameters.timeoutMs === 0 ? modelDefaultTimeoutMs : parameters.timeoutMs,
  }
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
