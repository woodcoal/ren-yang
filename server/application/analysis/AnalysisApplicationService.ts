import { createHash } from 'node:crypto'
import { modelGrowthExtractionResultSchema, modelLearningPromptResultSchema, modelMemoryExtractionResultSchema } from '../../../shared/schemas/analysis'
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
import type { TokenCounter } from '../../ports/TokenCounter'
import { TextModelError } from '../../ports/TextModelPort'
import { ApplicationError } from '../errors/ApplicationError'
import type { AiPromptApplicationService } from '../aiPrompts/AiPromptApplicationService'
import type { AiAlgorithmApplicationService } from '../aiConfiguration/AiAlgorithmApplicationService'
import { validateAndMergeGrowthFacts } from './GrowthFactValidator'
import type { AiAlgorithmSnapshot } from '../../domain/ai/AiAlgorithmModels'
import { analysisInputKey } from '../../domain/analysis/AnalysisInputKey'
import { validateAndMergeMemoryFacts } from './MemoryFactValidator'

/** 纯文本提炼不再要求模型额外生成摘要，任务页展示固定结果说明。 */
const LEARNING_PROMPT_RESULT_SUMMARY = 'AI 已根据全部启用素材生成完整提示词草稿。'
/** 提取阶段明确没有形成新事实时使用的稳定批次说明。 */
const NO_ANALYSIS_CHANGE_SUMMARY = '没有形成新事实。'

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
  /** 数据库配置的两阶段成长或记忆算法；未提供时保持旧单模型路径。 */
  algorithms?: Pick<AiAlgorithmApplicationService, 'prepare' | 'executeStep'>
  /** 自动发布前使用的提示词 Token 计数器。 */
  tokenCounter?: TokenCounter
  /** 各类学习提示词自动发布时允许的 Token 上限。 */
  promptTokenBudgets?: Record<AnalysisType, number>
}

/** 创建、执行和审核世界成长、人物成长及人物记忆 AI 迭代。 */
export class AnalysisApplicationService implements TaskHandler {
  /**
   * 创建 AI 迭代应用服务。
   * @param dependencies 内容、灵魂、学习、批次、模型、标识和时间端口。
   */
  constructor(private readonly dependencies: AnalysisApplicationServiceDependencies) {}

  /**
   * 创建并固定一次成长或记忆提炼批次。
   * @param analysisType 分析类型。
   * @param subjectId 对象 UUID。
   * @param input 增量或完整重建模式。
   * @param options 是否由后台定时任务在完成后自动发布。
   * @returns 已排队批次。
   */
  async createBatch(
    analysisType: AnalysisType,
    subjectId: string,
    input: CreateAnalysisBatchInput,
    options: { autoPublish: boolean } = { autoPublish: false },
  ): Promise<AnalysisBatchView> {
    const algorithmSnapshot = this.dependencies.algorithms
      ? await this.dependencies.algorithms.prepare(learningAlgorithmCode(analysisType))
      : null
    const model = algorithmSnapshot
      ? algorithmTextModelSnapshot(algorithmSnapshot)
      : this.dependencies.model.getConfiguredModel()
    if (!model) throw new ApplicationError('CAPABILITY_DISABLED', '文本模型尚未配置，不能分析成长或记忆', 422)
    const prepared = await this.prepareBatch(analysisType, subjectId, input.mode)
    const algorithmStep = algorithmSnapshot?.steps[0]
    if (algorithmSnapshot && !algorithmStep) {
      throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_INVALID', '分析算法快照缺少首个步骤', 409)
    }
    const promptCode = algorithmStep?.promptCode ?? analysisPromptCode(analysisType)
    const promptVersions = algorithmStep ? null : await this.dependencies.prompts.snapshotPublishedVersions([promptCode])
    const promptVersion = algorithmStep?.promptVersionId ?? promptVersions?.[promptCode]
    if (!promptVersion) throw new ApplicationError('AI_PROMPT_NOT_PUBLISHED', '分析提示词尚未发布', 409)
    const parameters = algorithmStep
      ? { ...ANALYSIS_PARAMETERS, ...algorithmStep.parameters }
      : { ...ANALYSIS_PARAMETERS }
    const batchId = this.dependencies.identifiers.create()
    const created = await this.dependencies.analysis.createBatch({
      id: batchId,
      taskId: this.dependencies.identifiers.create(),
      analysisType,
      subjectId,
      mode: input.mode,
      baselineSoulVersionId: prepared.soul.id,
      baselineLearningPromptVersionId: prepared.baselineLearningPromptVersionId,
      baselineLearningPromptHash: prepared.baselineLearningPromptHash,
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
      autoPublish: options.autoPublish,
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
        if (runtime.algorithmSnapshot.algorithmCode === 'persona_memory') {
          await this.executeConfiguredMemoryAlgorithm(
            batchId, runtime.algorithmSnapshot, runtime.baseline, runtime.batch.inputs, runtime.autoPublish,
          )
        }
        else {
          await this.executeConfiguredGrowthAlgorithm(
            batchId, runtime.algorithmSnapshot, runtime.baseline, runtime.batch.inputs, runtime.autoPublish,
          )
        }
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
      this.validateAutomaticPublication(runtime.batch.analysisType, result.promptText, runtime.autoPublish)
      const saveStatus = await this.dependencies.analysis.saveLearningPromptResult(
        batchId, result, this.dependencies.identifiers.create(), this.dependencies.identifiers.create(), this.dependencies.clock.now(),
        runtime.autoPublish ? { versionId: this.dependencies.identifiers.create(), changeSummary: '系统定时提炼并自动发布' } : undefined,
      )
      this.requireLearningPromptSave(saveStatus)
    }
    catch (error: unknown) {
      const normalized = normalizeAnalysisError(error)
      // 瞬态模型输出问题由同一任务重试；首次失败不能抹去批次的运行阶段。
      if (!normalized.retryable || job.attemptCount >= job.maxAttempts) {
        await this.dependencies.analysis.failBatch(batchId, normalized.code, normalized.message, this.dependencies.clock.now())
      }
      throw new TaskExecutionError(normalized.message, normalized.retryable)
    }
  }

  /**
   * 执行成长资料的原子提取、程序证据校验去重和完整提示词综合。
   * @param batchId 正在运行的分析批次 UUID。
   * @param snapshot 创建批次时固定的算法配置。
   * @param baseline 当前灵魂与当前成长提示词基线。
   * @param inputs 创建批次时固定的成长资料输入。
   * @param autoPublish 创建批次时固定的自动发布行为。
   * @returns 两步模型调用与草稿保存完成时结束。
   */
  private async executeConfiguredGrowthAlgorithm(
    batchId: string,
    snapshot: AiAlgorithmSnapshot,
    baseline: unknown[],
    inputs: AnalysisBatchView['inputs'],
    autoPublish: boolean,
  ): Promise<void> {
    const algorithms = this.dependencies.algorithms
    if (!algorithms) throw new ApplicationError('CAPABILITY_DISABLED', '成长分析算法不可用', 422)
    const extractResponse = await algorithms.executeStep(
      snapshot,
      'extract',
      buildAnalysisPromptVariables(baseline, inputs),
      'growth_atomic_facts',
      'json_object',
      {
        limits: { ...ANALYSIS_PARAMETERS, ...snapshot.steps.find(step => step.stepKey === 'extract')?.parameters },
        validateStructuredOutput: value => {
          const extracted = modelGrowthExtractionResultSchema.parse(value)
          validateAndMergeGrowthFacts(extracted.facts, inputs)
        },
      },
    )
    const extracted = modelGrowthExtractionResultSchema.parse(extractResponse.structuredOutput)
    const facts = validateAndMergeGrowthFacts(extracted.facts, inputs)
    await this.saveExtractionSnapshot(batchId, extracted, facts)
    if (facts.length === 0) {
      await this.completeWithoutChanges(batchId)
      return
    }
    const synthesizeResponse = await algorithms.executeStep(
      snapshot,
      'synthesize',
      { baselineJson: JSON.stringify(baseline), factsJson: JSON.stringify(facts) },
      'learning_prompt',
      'text',
      {
        limits: { ...ANALYSIS_PARAMETERS, ...snapshot.steps.find(step => step.stepKey === 'synthesize')?.parameters },
        priorUsage: extractResponse.usage,
        validateStructuredOutput: value => {
          modelLearningPromptResultSchema.parse({ promptText: value, summary: LEARNING_PROMPT_RESULT_SUMMARY })
        },
      },
    )
    const result = modelLearningPromptResultSchema.parse({
      promptText: synthesizeResponse.structuredOutput,
      summary: `AI 已依据 ${facts.length} 条去重原子结论生成完整提示词草稿。`,
    })
    const analysisType = snapshot.algorithmCode === 'world_growth' ? 'world_growth' : 'persona_growth'
    this.validateAutomaticPublication(analysisType, result.promptText, autoPublish)
    const saveStatus = await this.dependencies.analysis.saveLearningPromptResult(
      batchId, result, this.dependencies.identifiers.create(), this.dependencies.identifiers.create(), this.dependencies.clock.now(),
      autoPublish ? { versionId: this.dependencies.identifiers.create(), changeSummary: '系统定时提炼并自动发布' } : undefined,
    )
    this.requireLearningPromptSave(saveStatus)
  }

  /**
   * 执行人物记忆的证据提取、来源校验、独立证据门槛和完整提示词编译。
   * @param batchId 正在运行的分析批次 UUID。
   * @param snapshot 创建批次时固定的人物记忆算法配置。
   * @param baseline 当前人物灵魂与当前记忆提示词基线。
   * @param inputs 创建批次时固定的任务记录和第三方经历。
   * @param autoPublish 创建批次时固定的自动发布行为。
   * @returns 两步模型调用与待人工发布草稿保存完成时结束。
   */
  private async executeConfiguredMemoryAlgorithm(
    batchId: string,
    snapshot: AiAlgorithmSnapshot,
    baseline: unknown[],
    inputs: AnalysisBatchView['inputs'],
    autoPublish: boolean,
  ): Promise<void> {
    const algorithms = this.dependencies.algorithms
    if (!algorithms) throw new ApplicationError('CAPABILITY_DISABLED', '人物记忆算法不可用', 422)
    const extractResponse = await algorithms.executeStep(
      snapshot,
      'extract',
      buildAnalysisPromptVariables(baseline, inputs),
      'memory_evidence_facts',
      'json_object',
      {
        limits: { ...ANALYSIS_PARAMETERS, ...snapshot.steps.find(step => step.stepKey === 'extract')?.parameters },
        validateStructuredOutput: value => { modelMemoryExtractionResultSchema.parse(value) },
      },
    )
    const extracted = modelMemoryExtractionResultSchema.parse(extractResponse.structuredOutput)
    const facts = validateAndMergeMemoryFacts(extracted.facts, inputs)
    await this.saveExtractionSnapshot(batchId, extracted, facts)
    if (facts.length === 0) {
      await this.completeWithoutChanges(batchId)
      return
    }
    if (autoPublish && facts.some(fact => fact.conflicts.length > 0)) {
      throw new ApplicationError('ANALYSIS_FACT_CONFLICT', '人物记忆事实仍有未裁决冲突，不能自动发布', 409)
    }
    const synthesizeResponse = await algorithms.executeStep(
      snapshot,
      'synthesize',
      { baselineJson: JSON.stringify(baseline), factsJson: JSON.stringify(facts) },
      'learning_prompt',
      'text',
      {
        limits: { ...ANALYSIS_PARAMETERS, ...snapshot.steps.find(step => step.stepKey === 'synthesize')?.parameters },
        priorUsage: extractResponse.usage,
        validateStructuredOutput: value => {
          modelLearningPromptResultSchema.parse({ promptText: value, summary: LEARNING_PROMPT_RESULT_SUMMARY })
        },
      },
    )
    const result = modelLearningPromptResultSchema.parse({
      promptText: synthesizeResponse.structuredOutput,
      summary: `AI 已依据 ${facts.length} 条达到独立证据门槛的记忆事实生成完整提示词草稿。`,
    })
    this.validateAutomaticPublication('persona_memory', result.promptText, autoPublish)
    const saveStatus = await this.dependencies.analysis.saveLearningPromptResult(
      batchId, result, this.dependencies.identifiers.create(), this.dependencies.identifiers.create(), this.dependencies.clock.now(),
      autoPublish ? { versionId: this.dependencies.identifiers.create(), changeSummary: '系统定时提炼并自动发布' } : undefined,
    )
    this.requireLearningPromptSave(saveStatus)
  }

  /**
   * 保存提取原始输出和程序校验后的事实快照。
   * @param batchId 正在运行的分析批次 UUID。
   * @param extraction 模型提取阶段的结构化输出。
   * @param facts 程序完成引用、去重和门槛校验后的事实。
   * @returns 快照持久化完成时结束。
   */
  private async saveExtractionSnapshot(batchId: string, extraction: unknown, facts: unknown[]): Promise<void> {
    const saved = await this.dependencies.analysis.saveExtractionSnapshot(
      batchId, extraction, facts, this.dependencies.clock.now(),
    )
    if (!saved) throw new ApplicationError('VERSION_CONFLICT', '分析批次状态已经变化', 409)
  }

  /** @param batchId 正在运行的分析批次 UUID。 @returns 无新事实批次完成时结束。 */
  private async completeWithoutChanges(batchId: string): Promise<void> {
    const completed = await this.dependencies.analysis.completeWithoutChanges(
      batchId, NO_ANALYSIS_CHANGE_SUMMARY, this.dependencies.clock.now(),
    )
    if (!completed) throw new ApplicationError('VERSION_CONFLICT', '分析批次状态已经变化', 409)
  }

  /**
   * 把仓储保存结果转换为稳定应用错误。
   * @param status 草稿或自动发布的原子保存结果。
   * @returns 保存成功时结束。
   * @throws 当前学习提示词或草稿已变化时抛出版本冲突。
   */
  private requireLearningPromptSave(status: 'saved' | 'batch_changed' | 'version_conflict'): void {
    if (status === 'saved') return
    if (status === 'version_conflict') {
      throw new ApplicationError('VERSION_CONFLICT', '分析期间当前学习提示词或草稿已经变化，结果未覆盖现有内容', 409)
    }
    throw new ApplicationError('VERSION_CONFLICT', '分析批次状态已经变化', 409)
  }

  /**
   * 自动发布前复用人工发布的 Token 预算规则。
   * @param analysisType 学习提示词类型。
   * @param promptText 待发布完整正文。
   * @param autoPublish 是否需要自动发布。
   * @returns 无返回值。
   */
  private validateAutomaticPublication(analysisType: AnalysisType, promptText: string, autoPublish: boolean): void {
    if (!autoPublish) return
    const counter = this.dependencies.tokenCounter
    const budget = this.dependencies.promptTokenBudgets?.[analysisType]
    if (!counter || budget === undefined) throw new ApplicationError('CAPABILITY_DISABLED', '自动发布 Token 预算尚未配置', 503)
    const count = counter.count(null, promptText)
    if (count.tokens > budget) {
      throw new ApplicationError(
        'LEARNING_PROMPT_TOKEN_BUDGET_EXCEEDED',
        `提示词预计 ${count.tokens} Token，超过当前 ${budget} Token 限制，请先精简文本`,
        422,
      )
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
    let baselineLearningPromptVersionId: string | null
    let baselineLearningPromptHash: string | null
    let sourceInputs: Array<Omit<CreateAnalysisBatchInputRecord, 'id' | 'isNew'>>
    if (analysisType === 'world_growth') {
      const [materials, promptWorkspace] = await Promise.all([
        this.dependencies.learning.listGrowthMaterials('world', subjectId),
        this.dependencies.learning.findLearningPromptWorkspace('world_growth', subjectId),
      ])
      const activePrompt = promptWorkspace?.activeVersion ?? null
      baseline = activePrompt ? [{ type: 'learning_prompt', promptText: activePrompt.promptText }] : []
      baselineLearningPromptVersionId = activePrompt?.id ?? null
      baselineLearningPromptHash = activePrompt ? hashPromptText(activePrompt.promptText) : null
      sourceInputs = materials.filter(item => item.isEnabled).map(item => ({
        inputType: 'growth_material', inputId: item.id, title: item.title,
        content: item.content, contentHash: item.contentHash, importance: item.importance,
      }))
    }
    else if (analysisType === 'persona_growth') {
      const [materials, promptWorkspace] = await Promise.all([
        this.dependencies.learning.listGrowthMaterials('persona', subjectId),
        this.dependencies.learning.findLearningPromptWorkspace('persona_growth', subjectId),
      ])
      const activePrompt = promptWorkspace?.activeVersion ?? null
      baseline = activePrompt ? [{ type: 'learning_prompt', promptText: activePrompt.promptText }] : []
      baselineLearningPromptVersionId = activePrompt?.id ?? null
      baselineLearningPromptHash = activePrompt ? hashPromptText(activePrompt.promptText) : null
      sourceInputs = materials.filter(item => item.isEnabled).map(item => ({
        inputType: 'growth_material', inputId: item.id, title: item.title,
        content: item.content, contentHash: item.contentHash, importance: item.importance,
      }))
    }
    else {
      const [operations, externalRecords, promptWorkspace] = await Promise.all([
        this.dependencies.learning.listPersonaOperationRecords(subjectId),
        this.dependencies.learning.listPersonaExternalRecords(subjectId),
        this.dependencies.learning.findLearningPromptWorkspace('persona_memory', subjectId),
      ])
      const activePrompt = promptWorkspace?.activeVersion ?? null
      baseline = activePrompt ? [{ type: 'learning_prompt', promptText: activePrompt.promptText }] : []
      baselineLearningPromptVersionId = activePrompt?.id ?? null
      baselineLearningPromptHash = activePrompt ? hashPromptText(activePrompt.promptText) : null
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
      baselineLearningPromptVersionId,
      baselineLearningPromptHash,
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
 * 把学习分析类型映射到对应的固定算法编码。
 * @param analysisType 世界成长、人物成长或人物记忆。
 * @returns 对应的两阶段固定算法编码。
 */
function learningAlgorithmCode(analysisType: AnalysisType): 'world_growth' | 'persona_growth' | 'persona_memory' {
  return analysisType
}

/**
 * 从算法第一步骤生成兼容旧分析批次字段的非敏感模型快照。
 * @param snapshot 已固定的完整算法配置。
 * @returns 旧查询和历史页面仍可读取的文本模型快照。
 */
function algorithmTextModelSnapshot(snapshot: AiAlgorithmSnapshot) {
  const step = snapshot.steps[0]
  if (!step) throw new ApplicationError('AI_ALGORITHM_CONFIGURATION_INVALID', '分析算法快照缺少模型步骤', 409)
  return {
    provider: 'openai_compatible' as const,
    model: step.model,
    endpointOrigin: new URL(step.endpoint).origin,
  }
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
        // 模型只能看到并引用批次证据 UUID，避免误把原资料 UUID 当作证据引用返回。
        id: item.id, inputType: item.inputType, title: item.title,
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

function normalizeAnalysisError(error: unknown): { code: string, message: string, retryable: boolean } {
  if (error instanceof TextModelError) return { code: error.code, message: error.message, retryable: error.retryable }
  if (error instanceof ApplicationError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.code === 'MODEL_OUTPUT_INVALID',
    }
  }
  return { code: 'MODEL_OUTPUT_INVALID', message: '模型返回的完整提示词不符合业务约束', retryable: false }
}

/** @param promptText 已发布学习提示词正文。 @returns 用于批次 CAS 的 SHA-256 十六进制哈希。 */
function hashPromptText(promptText: string): string {
  return createHash('sha256').update(promptText, 'utf8').digest('hex')
}
