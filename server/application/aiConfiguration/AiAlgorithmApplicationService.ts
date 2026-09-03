import { createHash } from 'node:crypto'
import type { AiAlgorithmStepParameters } from '../../../shared/schemas/aiConfiguration'
import { textModelParametersSchema, type TextModelParameters } from '../../../shared/schemas/generation'
import type { AiAlgorithmCode } from '../../../shared/types/aiConfiguration'
import type { AiAlgorithmSnapshot, AiAlgorithmStepSnapshot } from '../../domain/ai/AiAlgorithmModels'
import { getAiAlgorithmDefinition } from '../../domain/ai/AiAlgorithmDefinitions'
import { connectionSecretContext } from '../../domain/ai/AiConnectionSecret'
import type { AiConfigurationRepository, AiConnectionSecretRecord } from '../../ports/AiConfigurationRepository'
import type { AiModelFactory } from '../../ports/AiModelFactory'
import type { SecretCipher } from '../../ports/SecretCipher'
import type { SystemAiSettingsRepository } from '../../ports/SystemAiSettingsRepository'
import type { TextModelResponse } from '../../ports/TextModelPort'
import { TextModelError } from '../../ports/TextModelPort'
import type { ImageModelResponse, ImageModelRequest } from '../../ports/ImageModelPort'
import type { TokenCounter } from '../../ports/TokenCounter'
import type { TextModelUsage } from '../../domain/generation/GenerationModels'
import type { AiPromptApplicationService } from '../aiPrompts/AiPromptApplicationService'
import { ApplicationError } from '../errors/ApplicationError'
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

/** 配置算法单步骤可选的运行预算、结构校验和缓存亲和要求。 */
export interface AiAlgorithmStepExecutionOptions {
  /** 稳定系统提示词是否进入同键串行调度并发送缓存路由键。 */
  useCacheAffinity?: boolean
  /** 本次运行创建时固定的完整预算；省略时使用算法硬默认值。 */
  limits?: TextModelParameters
  /** 本次运行此前已经产生的供应商用量。 */
  priorUsage?: TextModelUsage | null
  /** 首次输出失败时触发一次不携带旧回答的结构修正调用。 */
  validateStructuredOutput?: (value: unknown) => void
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
  /** 按模型名称保守或精确计算最终提示 Token。 */
  tokenCounter: TokenCounter
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
      const promptVersionId = promptVersions[definitionStep.promptCode]
      if (!promptVersionId) {
        throw new ApplicationError('AI_PROMPT_NOT_PUBLISHED', `算法步骤“${definitionStep.name}”的提示词尚未发布`, 422)
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
        promptVersionId,
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
   * 使用已固定快照执行一个步骤；当前数据库仅提供可轮换的连接密文。
   * @param snapshot 创建任务时保存的非敏感算法快照。
   * @param stepKey 待执行的固定步骤标识。
   * @param variables 提示词模板的完整变量。
   * @param responseSchemaName 供应商诊断使用的结构名称。
   * @param responseFormat JSON 对象或纯文本输出。
   * @param options 可选运行预算、结构校验和缓存亲和要求。
   * @returns 模型输出和本步骤全部调用的累计用量。
   */
  async executeStep(
    snapshot: AiAlgorithmSnapshot,
    stepKey: string,
    variables: Record<string, string>,
    responseSchemaName: string,
    responseFormat: 'json_object' | 'text',
    options: AiAlgorithmStepExecutionOptions = {},
  ): Promise<TextModelResponse> {
    const { step, connection } = await this.resolveStep(snapshot, stepKey, 'text')
    const prompt = await this.dependencies.prompts.render(step.promptCode, variables, step.promptVersionId)
    const parameters = textModelParametersSchema.parse({
      ...(options.limits ?? ALGORITHM_PARAMETER_DEFAULTS),
      ...step.parameters,
    })
    this.validatePromptBudget(prompt, step.model, parameters, options.priorUsage ?? null)
    const key = buildAiCacheAffinityKey({
      systemPrompt: prompt.systemPrompt,
      algorithmCode: snapshot.algorithmCode,
      promptVersionId: step.promptVersionId,
      modelDeploymentId: step.modelDeploymentId,
      fixedParameters: {
        ...parameters,
        thinkingDisableMode: step.thinkingDisableMode ?? 'none',
        responseSchemaName,
        responseFormat,
      },
    })
    const execute = async (currentPrompt: typeof prompt) => {
      if (!options.useCacheAffinity) {
        return await this.generate(step, connection, currentPrompt, parameters, responseSchemaName, responseFormat)
      }
      return await this.cacheAffinityScheduler.run(
        key,
        async () => await this.generate(step, connection, currentPrompt, parameters, responseSchemaName, responseFormat, key),
      )
    }
    const first = await execute(prompt)
    if (!options.validateStructuredOutput) return first
    try {
      options.validateStructuredOutput(first.structuredOutput)
      return first
    }
    catch (error: unknown) {
      const repairPrompt = buildStructuredRepairPrompt(prompt, error)
      this.validatePromptBudget(
        repairPrompt,
        step.model,
        parameters,
        aggregateTextModelUsage(options.priorUsage ? [options.priorUsage, first.usage] : [first.usage]),
      )
      const repaired = await execute(repairPrompt)
      options.validateStructuredOutput(repaired.structuredOutput)
      return { ...repaired, usage: aggregateTextModelUsage([first.usage, repaired.usage]) }
    }
  }


  /**
   * 使用已固定的图片算法步骤生成一张图片；当前数据库仅提供可轮换的连接密文。
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
    this.validatePromptLength(prompt.systemPrompt, prompt.userPrompt, ALGORITHM_PARAMETER_DEFAULTS.maxPromptCharacters)
    const model = this.dependencies.modelFactory.createImageModel({
      endpoint: step.endpoint,
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
    this.validatePromptLength(prompt.systemPrompt, prompt.userPrompt, ALGORITHM_PARAMETER_DEFAULTS.maxPromptCharacters)
    const startedAt = performance.now()
    try {
      const response = await this.generate(
        step,
        connection,
        prompt,
        textModelParametersSchema.parse({ ...ALGORITHM_PARAMETER_DEFAULTS, ...step.parameters }),
        responseSchemaName,
        responseFormat,
      )
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
   * 校验算法实现与步骤快照，并读取执行时所需的当前连接密文。
   * @param snapshot 创建任务或测试时固定的算法快照。
   * @param stepKey 待解析的固定步骤标识。
   * @returns 已校验步骤和仍存在的连接密文记录。
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
    const connection = await this.dependencies.repository.findConnection(step.connectionId)
    if (!connection) throw new ApplicationError('CAPABILITY_DISABLED', '算法快照引用的 AI 接口连接不存在', 422)
    return { step, connection }
  }

  /**
   * 使用已校验连接临时解密密钥并执行模型调用。
   * @param step 已校验的算法步骤快照。
   * @param connection 已校验且启用的连接记录。
   * @param prompt 已完成变量替换的系统与用户提示词。
   * @param parameters 已解析且通过预算关系校验的完整模型参数。
   * @param responseSchemaName 供应商诊断使用的结构名称。
   * @param responseFormat JSON 对象或纯文本输出。
   * @param promptCacheKey 可选 GPT-5.6 缓存路由键。
   * @returns 模型输出和用量。
   */
  private async generate(
    step: AiAlgorithmStepSnapshot,
    connection: AiConnectionSecretRecord,
    prompt: { systemPrompt: string, userPrompt: string },
    parameters: TextModelParameters,
    responseSchemaName: string,
    responseFormat: 'json_object' | 'text',
    promptCacheKey?: string,
  ): Promise<TextModelResponse> {
    const model = this.dependencies.modelFactory.createTextModel({
      endpoint: step.endpoint,
      apiKey: this.dependencies.secretCipher.decrypt(connection.apiKeyCiphertext, connectionSecretContext(connection.id)),
      model: step.model,
      userAgent: step.userAgent ?? '',
    })
    return await model.generateStructured({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      parameters,
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
  private validatePromptLength(systemPrompt: string, userPrompt: string, maxPromptCharacters: number): void {
    if (systemPrompt.length + userPrompt.length > maxPromptCharacters) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '算法输入超过固定提示长度限制，请减少资料或分批处理', 422)
    }
  }

  /**
   * 在每次供应商调用前校验最终消息、输出预留和运行累计用量。
   * @param prompt 实际发送的系统与用户消息。
   * @param model 当前步骤固定的模型名称。
   * @param parameters 本次运行固定的完整预算。
   * @param priorUsage 本次调用之前已经产生的供应商用量。
   * @returns 预算允许时无返回值。
   */
  private validatePromptBudget(
    prompt: { systemPrompt: string, userPrompt: string },
    model: string,
    parameters: TextModelParameters,
    priorUsage: TextModelUsage | null,
  ): void {
    this.validatePromptLength(prompt.systemPrompt, prompt.userPrompt, parameters.maxPromptCharacters)
    const availableInputTokens = parameters.contextWindowTokens - parameters.reservedOutputTokens - parameters.safetyMarginTokens
    const inputTokens = this.dependencies.tokenCounter.count(model, `${prompt.systemPrompt}\n${prompt.userPrompt}`).tokens
    if (inputTokens > availableInputTokens) {
      throw new ApplicationError('PROMPT_BUDGET_EXCEEDED', '当前算法步骤的最终提示超过可用输入 Token', 422)
    }
    const consumedTokens = usageTotalTokens(priorUsage)
    if (consumedTokens !== null && consumedTokens >= parameters.maxTotalTokens) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '模型已报告的运行总 Token 达到上限', 422)
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
 * 构建不携带旧模型回答、且保持系统消息逐字不变的单次结构修正提示。
 * @param prompt 首次调用的实际提示。
 * @param error 首次结构校验错误。
 * @returns 仅在用户消息末尾追加固定修正要求的新提示。
 */
function buildStructuredRepairPrompt(
  prompt: { systemPrompt: string, userPrompt: string },
  error: unknown,
): { systemPrompt: string, userPrompt: string } {
  const message = error instanceof Error ? error.message.slice(0, 2_000) : '结构化输出不符合约束'
  const details = error instanceof ApplicationError && error.details
    ? `；可用约束：${JSON.stringify(error.details)}`
    : ''
  const inputHash = createHash('sha256').update(prompt.userPrompt).digest('hex')
  return {
    systemPrompt: prompt.systemPrompt,
    userPrompt: `${prompt.userPrompt}\n\n<结构修正要求>上次响应未通过结构校验。请重新根据原始输入生成完整结果，不要解释，不要引用或复述上次回答。输入哈希：${inputHash}；校验错误：${message}${details}</结构修正要求>`,
  }
}

/** @param usages 一次步骤内的供应商用量。 @returns 所有已知字段的严格累计结果。 */
function aggregateTextModelUsage(usages: TextModelUsage[]): TextModelUsage {
  const cached = usages.map(usage => usage.cachedInputTokens)
  return {
    inputTokens: sumKnownUsageValues(usages.map(usage => usage.inputTokens)),
    outputTokens: sumKnownUsageValues(usages.map(usage => usage.outputTokens)),
    totalTokens: sumKnownUsageValues(usages.map(usage => usage.totalTokens)),
    ...(cached.some(value => value !== undefined) ? { cachedInputTokens: sumKnownUsageValues(cached.map(value => value ?? null)) } : {}),
  }
}

/** @param values 同一用量字段的全部供应商返回值。 @returns 全部已知时返回总和，任一未知时返回 null。 */
function sumKnownUsageValues(values: Array<number | null>): number | null {
  return values.every((value): value is number => value !== null)
    ? values.reduce((total, value) => total + value, 0)
    : null
}

/** @param usage 可选模型用量。 @returns 总 Token；供应商未报告足够字段时返回 null。 */
function usageTotalTokens(usage: TextModelUsage | null): number | null {
  if (!usage) return null
  if (usage.totalTokens !== null) return usage.totalTokens
  return usage.inputTokens !== null && usage.outputTokens !== null ? usage.inputTokens + usage.outputTokens : null
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
