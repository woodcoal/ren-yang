import {
  createAiConnectionSchema,
  publishAiAlgorithmConfigurationSchema,
  saveAiModelDeploymentSchema,
  updateAiConnectionSchema,
  type CreateAiConnectionInput,
  type PublishAiAlgorithmConfigurationInput,
  type SaveAiModelDeploymentInput,
  type UpdateAiConnectionInput,
} from '../../../shared/schemas/aiConfiguration'
import type {
  AiAlgorithmCode,
  AiAlgorithmView,
  AiConnectionCheckResult,
  AiConnectionView,
  AiModelDeploymentView,
} from '../../../shared/types/aiConfiguration'
import { AI_ALGORITHM_DEFINITIONS, getAiAlgorithmDefinition } from '../../domain/ai/AiAlgorithmDefinitions'
import type { AiConfigurationRepository } from '../../ports/AiConfigurationRepository'
import type { AiModelFactory } from '../../ports/AiModelFactory'
import type { Clock } from '../../ports/Clock'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { SecretCipher } from '../../ports/SecretCipher'
import type { AiPromptApplicationService } from '../aiPrompts/AiPromptApplicationService'
import { ApplicationError } from '../errors/ApplicationError'

/** 在线检测文本部署时使用的最小且有界参数。 */
const CONNECTION_CHECK_PARAMETERS = {
  temperature: 0,
  maxOutputTokens: 64,
  timeoutMs: 15_000,
  maxEvidenceChunks: 0,
  maxTextBlocks: 1,
  maxImageBlocks: 0,
  maxPromptCharacters: 1_000,
  maxTotalTokens: 256,
  maxBlockAttempts: 1,
  contextWindowTokens: 4_096,
  reservedOutputTokens: 64,
  safetyMarginTokens: 256,
  worldBudgetTokens: 0,
  worldSoulBudgetTokens: 0,
  worldGrowthBudgetTokens: 0,
  personaBudgetTokens: 1,
  personaSoulBudgetTokens: 1,
  personaGrowthBudgetTokens: 0,
  personaMemoryBudgetTokens: 0,
  sourceBudgetTokens: 0,
} as const

/** AI 配置管理应用服务依赖。 */
export interface AiConfigurationApplicationServiceDependencies {
  /** AI 配置事实源。 */
  repository: AiConfigurationRepository
  /** AES-GCM 可取回密钥加密端口。 */
  secretCipher: SecretCipher
  /** 动态模型适配器工厂。 */
  modelFactory: AiModelFactory
  /** 提示词版本校验服务。 */
  prompts: Pick<AiPromptApplicationService, 'snapshotPublishedVersions'>
  /** UUID 生成端口。 */
  identifiers: IdentifierGenerator
  /** 可测试时钟。 */
  clock: Clock
}

/** 管理加密 AI 接口、具体模型部署和固定算法的版本化配置。 */
export class AiConfigurationApplicationService {
  /**
   * 创建 AI 配置管理服务。
   * @param dependencies 仓储、加密器、模型工厂、提示词、标识和时钟。
   */
  constructor(private readonly dependencies: AiConfigurationApplicationServiceDependencies) { }

  /** @returns 全部脱敏 AI 接口连接。 */
  async listConnections(): Promise<AiConnectionView[]> {
    return await this.dependencies.repository.listConnections()
  }

  /** @param input 已校验的新连接参数。 @returns 创建后的脱敏连接。 */
  async createConnection(input: CreateAiConnectionInput): Promise<AiConnectionView> {
    const normalized = createAiConnectionSchema.parse(input)
    const id = this.dependencies.identifiers.create()
    return await this.persistConfiguration(() => this.dependencies.repository.createConnection({
      id,
      name: normalized.name,
      protocol: normalized.protocol,
      endpoint: normalized.endpoint,
      userAgent: normalized.userAgent,
      apiKeyCiphertext: this.dependencies.secretCipher.encrypt(normalized.apiKey, connectionSecretContext(id)),
      isEnabled: normalized.isEnabled,
      timestamp: this.dependencies.clock.now(),
    }))
  }

  /**
   * 编辑连接；未提交新 API Key 时保留数据库中的原密文。
   * @param id 连接 UUID。
   * @param input 完整非敏感参数与可选新凭据。
   * @returns 更新后的脱敏连接。
   */
  async updateConnection(id: string, input: UpdateAiConnectionInput): Promise<AiConnectionView> {
    const normalized = updateAiConnectionSchema.parse(input)
    const current = await this.dependencies.repository.findConnection(id)
    if (!current) throw new ApplicationError('RESOURCE_NOT_FOUND', 'AI 接口连接不存在', 404)
    const updated = await this.persistConfiguration(() => this.dependencies.repository.updateConnection({
      id,
      name: normalized.name,
      protocol: normalized.protocol,
      endpoint: normalized.endpoint,
      userAgent: normalized.userAgent ?? current.userAgent,
      apiKeyCiphertext: normalized.apiKey
        ? this.dependencies.secretCipher.encrypt(normalized.apiKey, connectionSecretContext(id))
        : current.apiKeyCiphertext,
      isEnabled: normalized.isEnabled,
      timestamp: this.dependencies.clock.now(),
    }))
    if (!updated) throw new ApplicationError('VERSION_CONFLICT', 'AI 接口连接已变化，请刷新后重试', 409)
    return updated
  }

  /** @returns 全部模型部署。 */
  async listModelDeployments(): Promise<AiModelDeploymentView[]> {
    return await this.dependencies.repository.listModelDeployments()
  }

  /** @param input 新模型部署参数。 @returns 创建后的部署。 */
  async createModelDeployment(input: SaveAiModelDeploymentInput): Promise<AiModelDeploymentView> {
    const normalized = saveAiModelDeploymentSchema.parse(input)
    await this.requireConnection(normalized.connectionId)
    return await this.persistConfiguration(() => this.dependencies.repository.createModelDeployment({
      id: this.dependencies.identifiers.create(),
      ...normalized,
      thinkingControl: normalized.modality === 'text' ? normalized.thinkingControl ?? 'none' : 'none',
      timestamp: this.dependencies.clock.now(),
    }))
  }

  /** @param id 部署 UUID。 @param input 完整部署参数。 @returns 更新后的部署。 */
  async updateModelDeployment(id: string, input: SaveAiModelDeploymentInput): Promise<AiModelDeploymentView> {
    const normalized = saveAiModelDeploymentSchema.parse(input)
    await this.requireConnection(normalized.connectionId)
    if (!await this.dependencies.repository.findModelDeployment(id)) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', 'AI 模型部署不存在', 404)
    }
    const updated = await this.persistConfiguration(() => this.dependencies.repository.updateModelDeployment({
      id,
      ...normalized,
      thinkingControl: normalized.modality === 'text' ? normalized.thinkingControl ?? 'none' : 'none',
      timestamp: this.dependencies.clock.now(),
    }))
    if (!updated) throw new ApplicationError('VERSION_CONFLICT', 'AI 模型部署已变化，请刷新后重试', 409)
    return updated
  }

  /**
   * 使用真实最小文本请求检测模型部署、连接、凭据和模型标识。
   * @param deploymentId 待检测的文本模型部署 UUID。
   * @returns 不包含供应商响应正文的检测结果。
   */
  async checkModelDeployment(deploymentId: string): Promise<AiConnectionCheckResult> {
    const deployment = await this.requireDeployment(deploymentId)
    if (deployment.modality !== 'text') {
      throw new ApplicationError('VALIDATION_FAILED', '当前仅支持在线检测文本模型部署', 400)
    }
    const connection = await this.requireConnection(deployment.connectionId)
    const model = this.dependencies.modelFactory.createTextModel({
      endpoint: connection.endpoint,
      apiKey: this.dependencies.secretCipher.decrypt(connection.apiKeyCiphertext, connectionSecretContext(connection.id)),
      model: deployment.model,
      userAgent: connection.userAgent,
    })
    await model.generateStructured({
      systemPrompt: '你是接口连通性检测器，只返回 OK。',
      userPrompt: '返回 OK。',
      parameters: CONNECTION_CHECK_PARAMETERS,
      responseSchemaName: 'connection_check',
      responseFormat: 'text',
      thinkingDisableMode: deployment.thinkingControl
    })
    return { healthy: true, message: '接口、凭据和文本模型均可用' }
  }

  /** @returns 全部固定算法及各自当前生效配置。 */
  async listAlgorithms(): Promise<AiAlgorithmView[]> {
    return await Promise.all(Object.values(AI_ALGORITHM_DEFINITIONS).map(async (definition) => {
      const [active, versionCount] = await Promise.all([
        this.dependencies.repository.findActiveAlgorithmConfiguration(definition.code),
        this.dependencies.repository.countAlgorithmConfigurationVersions(definition.code),
      ])
      return {
        code: definition.code,
        name: definition.name,
        description: definition.description,
        implementationVersion: definition.implementationVersion,
        stepDefinitions: definition.steps,
        activeConfigurationVersion: active?.versionNo ?? null,
        steps: active
          ? definition.steps.map(step => ({
            ...step,
            modelDeploymentId: active.steps.find(item => item.stepKey === step.key)?.modelDeploymentId ?? '',
            parameters: active.steps.find(item => item.stepKey === step.key)?.parameters
              ?? { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 0 },
          }))
          : [],
        configurationVersionCount: versionCount,
        updatedAt: active?.createdAt ?? 0,
      }
    }))
  }

  /**
   * 校验固定步骤集合并发布一版完整算法配置。
   * @param code 固定算法编码。
   * @param input 每个固定步骤的模型部署与参数。
   * @returns 发布后的算法视图。
   */
  async publishAlgorithmConfiguration(
    code: AiAlgorithmCode,
    input: PublishAiAlgorithmConfigurationInput,
  ): Promise<AiAlgorithmView> {
    const definition = getAiAlgorithmDefinition(code)
    const normalized = publishAiAlgorithmConfigurationSchema.parse(input)
    const inputs = new Map(normalized.steps.map(step => [step.stepKey, step]))
    if (inputs.size !== normalized.steps.length || normalized.steps.length !== definition.steps.length
      || definition.steps.some(step => !inputs.has(step.key))) {
      throw new ApplicationError('VALIDATION_FAILED', '算法步骤必须与代码中的固定定义完全一致', 400)
    }
    await this.dependencies.prompts.snapshotPublishedVersions(definition.steps.map(step => step.promptCode))
    const steps = await Promise.all(definition.steps.map(async (definitionStep) => {
      const inputStep = inputs.get(definitionStep.key)!
      if (definitionStep.modality === 'image' && inputStep.parameters.disableThinking) {
        throw new ApplicationError('VALIDATION_FAILED', `图片步骤“${definitionStep.name}”不支持关闭思考`, 400)
      }
      if (!inputStep.modelDeploymentId) {
        return {
          id: this.dependencies.identifiers.create(), stepKey: definitionStep.key, ordinal: definitionStep.ordinal,
          modelDeploymentId: null, promptCode: definitionStep.promptCode, parameters: inputStep.parameters,
        }
      }
      const deployment = await this.requireDeployment(inputStep.modelDeploymentId)
      if (!deployment.isEnabled || deployment.modality !== definitionStep.modality) {
        throw new ApplicationError('CAPABILITY_DISABLED', `步骤“${definitionStep.name}”必须选择已启用的${definitionStep.modality === 'text' ? '文本' : '图片'}模型`, 422)
      }
      const connection = await this.requireConnection(deployment.connectionId)
      if (!connection.isEnabled) {
        throw new ApplicationError('CAPABILITY_DISABLED', `步骤“${definitionStep.name}”使用的接口连接未启用`, 422)
      }
      if (definitionStep.modality === 'text' && inputStep.parameters.disableThinking && deployment.thinkingControl === 'none') {
        throw new ApplicationError('AI_THINKING_CONTROL_NOT_CONFIGURED', `步骤“${definitionStep.name}”要求关闭思考，但模型部署未配置对应请求字段`, 422)
      }
      return {
        id: this.dependencies.identifiers.create(), stepKey: definitionStep.key, ordinal: definitionStep.ordinal,
        modelDeploymentId: deployment.id, promptCode: definitionStep.promptCode, parameters: inputStep.parameters,
      }
    }))
    await this.dependencies.repository.publishAlgorithmConfiguration({
      id: this.dependencies.identifiers.create(), algorithmCode: code, steps, timestamp: this.dependencies.clock.now(),
    })
    return (await this.listAlgorithms()).find(item => item.code === code)!
  }

  /** @param id 连接 UUID。 @returns 存在的服务端连接记录。 */
  private async requireConnection(id: string) {
    const connection = await this.dependencies.repository.findConnection(id)
    if (!connection) throw new ApplicationError('RESOURCE_NOT_FOUND', 'AI 接口连接不存在', 404)
    return connection
  }

  /** @param id 部署 UUID。 @returns 存在的模型部署。 */
  private async requireDeployment(id: string): Promise<AiModelDeploymentView> {
    const deployment = await this.dependencies.repository.findModelDeployment(id)
    if (!deployment) throw new ApplicationError('RESOURCE_NOT_FOUND', 'AI 模型部署不存在', 404)
    return deployment
  }

  /**
   * 把数据库唯一约束转换为稳定业务错误，同时保留其他异常。
   * @param operation 单次仓储写操作。
   * @returns 仓储操作结果。
   */
  private async persistConfiguration<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (error: unknown) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new ApplicationError('RESOURCE_CONFLICT', '接口名称或模型部署名称已经存在', 409)
      }
      throw error
    }
  }
}

/** @param connectionId AI 连接 UUID。 @returns AES-GCM 附加认证数据使用的稳定上下文。 */
export function connectionSecretContext(connectionId: string): string {
  return `ai_connection:${connectionId}`
}
