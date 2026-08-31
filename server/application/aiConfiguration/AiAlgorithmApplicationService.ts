import type { AiAlgorithmStepParameters } from '../../../shared/schemas/aiConfiguration'
import type { AiAlgorithmCode } from '../../../shared/types/aiConfiguration'
import type { AiAlgorithmSnapshot } from '../../domain/ai/AiAlgorithmModels'
import { getAiAlgorithmDefinition } from '../../domain/ai/AiAlgorithmDefinitions'
import type { AiConfigurationRepository } from '../../ports/AiConfigurationRepository'
import type { AiModelFactory } from '../../ports/AiModelFactory'
import type { SecretCipher } from '../../ports/SecretCipher'
import type { TextModelResponse } from '../../ports/TextModelPort'
import type { AiPromptApplicationService } from '../aiPrompts/AiPromptApplicationService'
import { ApplicationError } from '../errors/ApplicationError'
import { connectionSecretContext } from './AiConfigurationApplicationService'

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
  prompts: Pick<AiPromptApplicationService, 'render' | 'snapshotPublishedVersions'>
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
      || connection.endpoint !== step.endpoint || connection.protocol !== step.protocol) {
      throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_CHANGED', '算法使用的接口或模型已被编辑，请重新创建任务', 409)
    }
    const prompt = await this.dependencies.prompts.render(step.promptCode, variables, step.promptVersionId)
    if (prompt.systemPrompt.length + prompt.userPrompt.length > ALGORITHM_PARAMETER_DEFAULTS.maxPromptCharacters) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '算法输入超过固定提示长度限制，请减少资料或分批处理', 422)
    }
    const model = this.dependencies.modelFactory.createTextModel({
      endpoint: connection.endpoint,
      apiKey: this.dependencies.secretCipher.decrypt(connection.apiKeyCiphertext, connectionSecretContext(connection.id)),
      model: deployment.model,
    })
    return await model.generateStructured({
      ...prompt,
      parameters: buildTextModelParameters(step.parameters),
      responseSchemaName,
      responseFormat,
    })
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
