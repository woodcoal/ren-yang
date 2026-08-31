import { modelGrowthExtractionResultSchema, modelLearningPromptResultSchema } from '../../../shared/schemas/analysis'
import type { CreateAnalysisBatchInput, ListAnalysisBatchesInput, ReviewIterationProposalsInput } from '../../../shared/schemas/analysis'
import type { TextModelParameters } from '../../../shared/schemas/generation'
import type { AnalysisBatchView, AnalysisType } from '../../../shared/types/analysis'
import type { AnalysisRepository, CreateAnalysisBatchInputRecord } from '../../ports/AnalysisRepository'
import type { Clock } from '../../ports/Clock'
import type { ContentRepository } from '../../ports/ContentRepository'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { LearningRepository } from '../../ports/LearningRepository'
import type { SoulRepository } from '../../ports/SoulRepository'
import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { TaskHandler } from '../../ports/TaskPorts'
import { TaskExecutionError } from '../../ports/TaskPorts'
import type { TextModelPort } from '../../ports/TextModelPort'
import { TextModelError } from '../../ports/TextModelPort'
import { ApplicationError } from '../errors/ApplicationError'
import type { AiPromptApplicationService } from '../aiPrompts/AiPromptApplicationService'
import type { SystemAiSettingsApplicationService } from '../systemAi/SystemAiSettingsApplicationService'
import type { AiAlgorithmApplicationService } from '../aiConfiguration/AiAlgorithmApplicationService'
import type { AiAlgorithmSnapshot } from '../../domain/ai/AiAlgorithmModels'

/** 纯文本提炼不再要求模型额外生成摘要，任务页展示固定结果说明。 */
const LEARNING_PROMPT_RESULT_SUMMARY = 'AI 已根据全部启用素材生成完整提示词草稿。'

/** 分析任务固定参数，独立于用户内容生成参数。 */
const ANALYSIS_PARAMETERS: TextModelParameters = {
  temperature: 0.2,
  maxOutputTokens: 4_096,
  timeoutMs: 60_000,
  maxEvidenceChunks: 50,
  maxTextBlocks: 1,
  maxImageBlocks: 0,
  maxPromptCharacters: 160_000,
  maxTotalTokens: 32_000,
  maxBlockAttempts: 1,
}

/** AI 迭代应用服务依赖。 */
export interface AnalysisApplicationServiceDependencies {
  /** 人物与世界存在性查询。 */
  content: Pick<ContentRepository, 'findWorld' | 'findPersona'>
  /** 当前灵魂版本查询。 */
  souls: Pick<SoulRepository, 'findSoulVersion'>
  /** 成长原始资料、处理记录和当前结论查询。 */
  learning: LearningRepository
  /** 分析批次、任务和审核事实源。 */
  analysis: AnalysisRepository
  /** 结构化文本模型。 */
  model: TextModelPort
  /** 全站已发布 AI 提示词目录。 */
  prompts: Pick<AiPromptApplicationService, 'render' | 'snapshotPublishedVersions'>
  /** UUID 生成端口。 */
  identifiers: IdentifierGenerator
  /** 可测试时钟。 */
  clock: Clock
  /** 系统内容分析参数；未提供时保持原固定参数，便于独立测试。 */
  systemAiSettings?: Pick<SystemAiSettingsApplicationService, 'resolveParameters'>
  /** 数据库配置的两阶段成长算法；未提供时保持旧单模型路径。 */
  algorithms?: Pick<AiAlgorithmApplicationService, 'prepare' | 'executeStep'>
}

/** 创建、执行和审核世界成长、人物成长及人物记忆 AI 迭代。 */
export class AnalysisApplicationService implements TaskHandler {
  /**
   * 创建 AI 迭代应用服务。
   * @param dependencies 内容、灵魂、学习、批次、模型、标识和时间端口。
   */
  constructor(private readonly dependencies: AnalysisApplicationServiceDependencies) {}

  /** @param analysisType 分析类型。 @param subjectId 对象 UUID。 @param input 分析模式。 @returns 已排队批次。 */
  async createBatch(analysisType: AnalysisType, subjectId: string, input: CreateAnalysisBatchInput): Promise<AnalysisBatchView> {
    const algorithmSnapshot = this.dependencies.algorithms && analysisType !== 'persona_memory'
      ? await this.dependencies.algorithms.prepare(growthAlgorithmCode(analysisType))
      : null
    const model = algorithmSnapshot
      ? algorithmTextModelSnapshot(algorithmSnapshot)
      : this.dependencies.model.getConfiguredModel()
    if (!model) throw new ApplicationError('CAPABILITY_DISABLED', '文本模型尚未配置，不能分析成长或记忆', 422)
    const prepared = await this.prepareBatch(analysisType, subjectId, input.mode)
    const promptCode = algorithmSnapshot ? algorithmSnapshot.steps[0]!.promptCode : analysisPromptCode(analysisType)
    const promptVersion = algorithmSnapshot
      ? algorithmSnapshot.steps[0]!.promptVersionId
      : (await this.dependencies.prompts.snapshotPublishedVersions([promptCode]))[promptCode]!
    const parameters = algorithmSnapshot
      ? { ...ANALYSIS_PARAMETERS, ...algorithmSnapshot.steps[0]!.parameters }
      : this.dependencies.systemAiSettings
        ? await this.dependencies.systemAiSettings.resolveParameters('contentAnalysis', ANALYSIS_PARAMETERS)
        : { ...ANALYSIS_PARAMETERS }
    const batchId = this.dependencies.identifiers.create()
    const created = await this.dependencies.analysis.createBatch({
      id: batchId,
      taskId: this.dependencies.identifiers.create(),
      analysisType,
      subjectId,
      mode: input.mode,
      baselineSoulVersionId: prepared.soul.id,
      baseline: [
        { type: 'soul', id: prepared.soul.id, promptText: prepared.soul.snapshot.promptText },
        ...prepared.baseline,
      ],
      model,
      parameters,
      promptVersion,
      algorithmSnapshot,
      inputs: prepared.inputs,
      timestamp: this.dependencies.clock.now(),
    })
    if (!created) {
      throw new ApplicationError('ANALYSIS_ALREADY_PENDING', '该对象已有排队或进行中的提炼，请等待完成后再试', 409)
    }
    const batch = await this.dependencies.analysis.findBatch(batchId)
    if (!batch) throw new ApplicationError('PERSISTENCE_CONFLICT', '分析批次创建后无法读取', 409)
    return batch
  }

  /** @param input 已校验的分析类型、对象、状态和数量过滤。 @returns 新批次在前的后台提炼记录。 */
  async listBatches(input: ListAnalysisBatchesInput): Promise<AnalysisBatchView[]> {
    return await this.dependencies.analysis.listBatches(input)
  }

  /** @param analysisType 分析类型。 @param subjectId 对象 UUID。 @returns 最新批次或 null。 */
  async getLatestBatch(analysisType: AnalysisType, subjectId: string): Promise<AnalysisBatchView | null> {
    await this.requireSubject(analysisType, subjectId)
    return await this.dependencies.analysis.findLatestBatch(analysisType, subjectId)
  }

  /** @param batchId 批次 UUID。 @returns 指定批次。 */
  async getBatch(batchId: string): Promise<AnalysisBatchView> {
    const batch = await this.dependencies.analysis.findBatch(batchId)
    if (!batch) throw new ApplicationError('RESOURCE_NOT_FOUND', '分析批次不存在', 404)
    return batch
  }

  /** @param batchId 批次 UUID。 @param input 人工逐条或批量审核。 @returns 审核并应用后的批次。 */
  async review(batchId: string, input: ReviewIterationProposalsInput): Promise<AnalysisBatchView> {
    const reviewed = await this.dependencies.analysis.reviewAndApply(batchId, input, this.dependencies.clock.now())
    if (!reviewed) throw new ApplicationError('VERSION_CONFLICT', '提案不存在、已审核或长期内容状态已经变化', 409)
    return reviewed
  }

  /** @param job Worker 已领取的分析任务。 @returns 模型分析和提案保存完成时结束。 */
  async execute(job: TaskJob): Promise<void> {
    if (job.type !== 'analyze_learning') throw new TaskExecutionError('未知学习分析任务', false)
    const batchId = readBatchId(job.payloadJson)
    const timestamp = this.dependencies.clock.now()
    try {
      // 批次固定参数也属于任务执行的一部分；反序列化失败时必须落为失败，不能永久停留在运行中。
      const runtime = await this.dependencies.analysis.startBatch(batchId, timestamp)
      if (!runtime) throw new ApplicationError('VERSION_CONFLICT', '分析批次不存在或状态已变化', 409)
      if (runtime.algorithmSnapshot) {
        await this.executeConfiguredGrowthAlgorithm(batchId, runtime.algorithmSnapshot, runtime.baseline, runtime.batch.inputs)
        return
      }
      const configured = this.dependencies.model.getConfiguredModel()
      if (!configured || configured.model !== runtime.model.model || configured.endpointOrigin !== runtime.model.endpointOrigin) {
        throw new TextModelError('CAPABILITY_DISABLED', '分析批次固定模型与当前配置不一致', false)
      }
      const promptCode = analysisPromptCode(runtime.batch.analysisType)
      const prompts = await this.dependencies.prompts.render(
        promptCode,
        buildAnalysisPromptVariables(runtime.baseline, runtime.batch.inputs),
        runtime.promptVersion,
      )
      if (prompts.systemPrompt.length + prompts.userPrompt.length > runtime.parameters.maxPromptCharacters) {
        throw new ApplicationError('TASK_LIMIT_EXCEEDED', '分析输入超过固定提示长度限制，请减少资料或分批分析', 422)
      }
      const response = await this.dependencies.model.generateStructured({
        ...prompts,
        parameters: runtime.parameters,
        responseSchemaName: 'learning_prompt',
        responseFormat: 'text',
      })
      const result = modelLearningPromptResultSchema.parse({
        promptText: response.structuredOutput,
        summary: LEARNING_PROMPT_RESULT_SUMMARY,
      })
      if (!await this.dependencies.analysis.saveLearningPromptResult(
        batchId, result, this.dependencies.identifiers.create(), this.dependencies.identifiers.create(), this.dependencies.clock.now(),
      )) {
        throw new Error('分析批次保存时状态已变化')
      }
    }
    catch (error: unknown) {
      const normalized = normalizeAnalysisError(error)
      await this.dependencies.analysis.failBatch(batchId, normalized.code, normalized.message, this.dependencies.clock.now())
      throw new TaskExecutionError(normalized.message, normalized.retryable)
    }
  }

  /**
   * 执行成长资料的原子提取、程序证据校验去重和完整提示词综合。
   * @param batchId 正在运行的分析批次 UUID。
   * @param snapshot 创建批次时固定的算法配置。
   * @param baseline 当前灵魂与当前成长提示词基线。
   * @param inputs 创建批次时固定的成长资料输入。
   * @returns 两步模型调用与草稿保存完成时结束。
   */
  private async executeConfiguredGrowthAlgorithm(
    batchId: string,
    snapshot: AiAlgorithmSnapshot,
    baseline: unknown[],
    inputs: AnalysisBatchView['inputs'],
  ): Promise<void> {
    const extractResponse = await this.dependencies.algorithms!.executeStep(
      snapshot,
      'extract',
      buildAnalysisPromptVariables(baseline, inputs),
      'growth_atomic_facts',
      'json_object',
    )
    const extracted = modelGrowthExtractionResultSchema.parse(extractResponse.structuredOutput)
    const facts = validateAndMergeGrowthFacts(extracted.facts, inputs)
    const synthesizeResponse = await this.dependencies.algorithms!.executeStep(
      snapshot,
      'synthesize',
      { baselineJson: JSON.stringify(baseline), factsJson: JSON.stringify(facts) },
      'learning_prompt',
      'text',
    )
    const result = modelLearningPromptResultSchema.parse({
      promptText: synthesizeResponse.structuredOutput,
      summary: `AI 已依据 ${facts.length} 条去重原子结论生成完整提示词草稿。`,
    })
    if (!await this.dependencies.analysis.saveLearningPromptResult(
      batchId, result, this.dependencies.identifiers.create(), this.dependencies.identifiers.create(), this.dependencies.clock.now(),
    )) {
      throw new Error('分析批次保存时状态已变化')
    }
  }

  /** @param analysisType 分析类型。 @param subjectId 对象 UUID。 @param mode 分析模式。 @returns 固定输入、基线和灵魂版本。 */
  private async prepareBatch(analysisType: AnalysisType, subjectId: string, mode: 'incremental' | 'full_rebuild') {
    const subject = await this.requireSubject(analysisType, subjectId)
    if (!subject.activeVersionId) throw new ApplicationError('SOUL_VERSION_MISSING', '当前灵魂版本缺失，请重新保存灵魂提示词', 409)
    const soul = await this.dependencies.souls.findSoulVersion(subject.activeVersionId)
    if (!soul) throw new ApplicationError('VERSION_CONFLICT', '当前灵魂版本不存在', 409)
    const analyzedKeys = new Set(await this.dependencies.analysis.listAnalyzedInputKeys(analysisType, subjectId))
    let baseline: Array<{ type: 'learning_prompt', promptText: string }>
    let sourceInputs: Array<Omit<CreateAnalysisBatchInputRecord, 'id' | 'isNew'>>
    if (analysisType === 'world_growth') {
      const [materials, activePrompt] = await Promise.all([
        this.dependencies.learning.listGrowthMaterials('world', subjectId),
        this.dependencies.learning.findActiveLearningPromptText('world_growth', subjectId),
      ])
      baseline = activePrompt ? [{ type: 'learning_prompt', promptText: activePrompt }] : []
      sourceInputs = materials.filter(item => item.isEnabled).map(item => ({
        inputType: 'growth_material', inputId: item.id, title: item.title,
        content: item.content, contentHash: item.contentHash, importance: item.importance,
      }))
    }
    else if (analysisType === 'persona_growth') {
      const [materials, activePrompt] = await Promise.all([
        this.dependencies.learning.listGrowthMaterials('persona', subjectId),
        this.dependencies.learning.findActiveLearningPromptText('persona_growth', subjectId),
      ])
      baseline = activePrompt ? [{ type: 'learning_prompt', promptText: activePrompt }] : []
      sourceInputs = materials.filter(item => item.isEnabled).map(item => ({
        inputType: 'growth_material', inputId: item.id, title: item.title,
        content: item.content, contentHash: item.contentHash, importance: item.importance,
      }))
    }
    else {
      const [operations, externalRecords, activePrompt] = await Promise.all([
        this.dependencies.learning.listPersonaOperationRecords(subjectId),
        this.dependencies.learning.listPersonaExternalRecords(subjectId),
        this.dependencies.learning.findActiveLearningPromptText('persona_memory', subjectId),
      ])
      baseline = activePrompt ? [{ type: 'learning_prompt', promptText: activePrompt }] : []
      sourceInputs = [
        ...operations.filter(item => item.isEnabled).map(item => ({
          inputType: 'persona_operation_record' as const, inputId: item.id,
          title: item.title, content: item.content, contentHash: item.contentHash, importance: item.importance,
        })),
        ...externalRecords.filter(item => item.isEnabled).map(item => ({
          inputType: 'persona_external_record' as const, inputId: item.id,
          title: `${item.occurredOn} 第三方经历`, content: item.analysisContent,
          contentHash: item.contentHash, importance: item.importance,
        })),
      ]
    }
    if (sourceInputs.length === 0) throw new ApplicationError('ANALYSIS_INPUT_REQUIRED', '没有已启用的原始资料可供分析', 422)
    const hasNewInput = sourceInputs.some(item => !analyzedKeys.has(analysisInputKey(item)))
    if (mode === 'incremental' && !hasNewInput) {
      throw new ApplicationError('NO_NEW_ANALYSIS_INPUT', '没有尚未分析的新资料；如需重新检查全部内容，请选择完整重建', 409)
    }
    return {
      soul,
      baseline,
      inputs: sourceInputs.map(item => ({
        ...item,
        id: this.dependencies.identifiers.create(),
        isNew: mode === 'full_rebuild' || !analyzedKeys.has(analysisInputKey(item)),
      })),
    }
  }

  /** @param analysisType 分析类型。 @param subjectId 对象 UUID。 @returns 对象记录。 */
  private async requireSubject(analysisType: AnalysisType, subjectId: string) {
    const subject = analysisType === 'world_growth'
      ? await this.dependencies.content.findWorld(subjectId)
      : await this.dependencies.content.findPersona(subjectId)
    if (!subject) throw new ApplicationError('RESOURCE_NOT_FOUND', analysisType === 'world_growth' ? '世界不存在' : '人物不存在', 404)
    return subject
  }
}

/**
 * 返回分析类型使用的固定提示词编码。
 * @param analysisType 世界成长、人物成长或人物记忆。
 * @returns 对应的提示词稳定编码。
 */
function analysisPromptCode(analysisType: AnalysisType): string {
  return `analysis.${analysisType}`
}

/**
 * 把成长分析类型映射到固定算法编码；人物记忆仍使用原独立流程。
 * @param analysisType 世界成长或人物成长。
 * @returns 对应的两阶段成长算法编码。
 */
function growthAlgorithmCode(analysisType: Exclude<AnalysisType, 'persona_memory'>): 'world_growth' | 'persona_growth' {
  return analysisType === 'world_growth' ? 'world_growth' : 'persona_growth'
}

/**
 * 从算法第一步骤生成兼容旧分析批次字段的非敏感模型快照。
 * @param snapshot 已固定的完整算法配置。
 * @returns 旧查询和历史页面仍可读取的文本模型快照。
 */
function algorithmTextModelSnapshot(snapshot: AiAlgorithmSnapshot) {
  const step = snapshot.steps[0]!
  return {
    provider: 'openai_compatible' as const,
    model: step.model,
    endpointOrigin: new URL(step.endpoint).origin,
  }
}

/**
 * 校验证据引用、合并完全相同的结论并计算实际证据数量。
 * @param facts 模型返回且已通过结构 Schema 的原子结论。
 * @param inputs 当前批次允许引用的不可变输入。
 * @returns 稳定排序、证据去重后的原子结论。
 */
function validateAndMergeGrowthFacts(
  facts: Array<{ statement: string, evidenceInputIds: string[], confidence: number }>,
  inputs: AnalysisBatchView['inputs'],
): Array<{ statement: string, evidenceInputIds: string[], evidenceCount: number, confidence: number }> {
  const validEvidenceIds = new Set(inputs.map(input => input.id))
  const merged = new Map<string, { statement: string, evidenceInputIds: Set<string>, confidence: number }>()
  for (const fact of facts) {
    if (fact.evidenceInputIds.some(id => !validEvidenceIds.has(id))) {
      throw new ApplicationError('MODEL_OUTPUT_INVALID', '模型返回的成长结论引用了不存在的资料', 502)
    }
    const key = fact.statement.replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN')
    const current = merged.get(key)
    if (current) {
      fact.evidenceInputIds.forEach(id => current.evidenceInputIds.add(id))
      current.confidence = Math.max(current.confidence, fact.confidence)
    }
    else {
      merged.set(key, {
        statement: fact.statement,
        evidenceInputIds: new Set(fact.evidenceInputIds),
        confidence: fact.confidence,
      })
    }
  }
  return [...merged.values()].map(fact => ({
    statement: fact.statement,
    evidenceInputIds: [...fact.evidenceInputIds].sort(),
    evidenceCount: fact.evidenceInputIds.size,
    confidence: fact.confidence,
  }))
}

/**
 * 构建成长或记忆提炼的模板变量。
 * @param baseline 当前灵魂和当前长期提示词。
 * @param inputs 创建批次时固定的原始输入。
 * @returns 与固定提示词变量契约完全一致的字符串映射。
 */
function buildAnalysisPromptVariables(
  baseline: unknown[],
  inputs: AnalysisBatchView['inputs'],
): Record<string, string> {
  return {
    baselineJson: JSON.stringify(baseline),
    inputsJson: JSON.stringify(inputs.map(item => ({
        id: item.id, inputType: item.inputType, inputId: item.inputId, title: item.title,
        content: item.contentSnapshot, importance: item.importance, isNew: item.isNew,
    }))),
  }
}

/** @param payloadJson 任务载荷。 @returns 已校验批次 UUID。 */
function readBatchId(payloadJson: string): string {
  try {
    const value = JSON.parse(payloadJson) as Record<string, unknown>
    if (typeof value.batchId === 'string' && /^[0-9a-f-]{36}$/i.test(value.batchId)) return value.batchId
  }
  catch {
    // 统一在下方返回不可重试的安全错误。
  }
  throw new TaskExecutionError('学习分析任务载荷无效', false)
}

/** @param error 未知模型或校验错误。 @returns 可持久化的稳定错误和重试语义。 */
function normalizeAnalysisError(error: unknown): { code: string, message: string, retryable: boolean } {
  if (error instanceof TextModelError) return { code: error.code, message: error.message, retryable: error.retryable }
  if (error instanceof ApplicationError) return { code: error.code, message: error.message, retryable: false }
  return { code: 'MODEL_OUTPUT_INVALID', message: '模型返回的完整提示词不符合业务约束', retryable: false }
}

/** @param input 分析原始输入。 @returns 类型、标识、正文哈希和评分组成的稳定增量键。 */
function analysisInputKey(input: { inputType: string, inputId: string, contentHash: string, importance: number }): string {
  return `${input.inputType}:${input.inputId}:${input.contentHash}:${input.importance}`
}
