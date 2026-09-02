import { createHash } from 'node:crypto'
import { personaDraftSchema } from '../../../shared/schemas/content'
import {
  confirmPersonaDistillationCandidateSchema,
  createPersonaDistillationSchema,
  modelPersonaDistillationEvaluationSchema,
  modelPersonaDistillationExtractionSchema,
  modelPersonaDistillationSourceAssessmentSchema,
  restartPersonaDistillationSchema,
  reviewPersonaDistillationSourcesSchema,
  savePersonaDistillationCandidateSchema,
} from '../../../shared/schemas/personaDistillation'
import type {
  ConfirmPersonaDistillationCandidateInput,
  CreatePersonaDistillationInput,
  ModelPersonaDistillationExtraction,
  ReviewPersonaDistillationSourcesInput,
  RestartPersonaDistillationInput,
  SavePersonaDistillationCandidateInput,
} from '../../../shared/schemas/personaDistillation'
import type { AiAlgorithmSnapshot } from '../../domain/ai/AiAlgorithmModels'
import {
  assertPersonaDistillationCandidateConfirmable,
  buildPersonaDistillationCoverage,
  buildPersonaDistillationQualityGate,
  validateAndMergePersonaDistillationClaims,
  validatePersonaDistillationSourceAssessment,
  PersonaDistillationRuleError,
} from '../../domain/distillation/PersonaDistillation'
import type { PersonaDistillationInput } from '../../domain/distillation/PersonaDistillation'
import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { AiAlgorithmApplicationService } from '../aiConfiguration/AiAlgorithmApplicationService'
import { ApplicationError } from '../errors/ApplicationError'
import type { Clock } from '../../ports/Clock'
import type { ContentRepository } from '../../ports/ContentRepository'
import type { ContextProvider } from '../../ports/ContextProvider'
import type { ContextSyncTaskQueue } from '../../ports/ContextSyncTaskQueue'
import type {
  DistillationRepository,
  PersonaDistillationClaimRecord,
  PersonaDistillationRunRecord,
} from '../../ports/DistillationRepository'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { TaskHandler } from '../../ports/TaskPorts'
import { TaskExecutionError } from '../../ports/TaskPorts'
import { TextModelError } from '../../ports/TextModelPort'
import type { TokenCounter } from '../../ports/TokenCounter'

/** 单次人物蒸馏允许固定到运行中的资料正文总字符数。 */
const MAX_DISTILLATION_SOURCE_CHARACTERS = 120_000

/** 人物蒸馏应用服务依赖。 */
export interface PersonaDistillationApplicationServiceDependencies {
  /** 人物、灵魂版本、世界、资料和资料切片查询。 */
  content: Pick<ContentRepository, 'findPersona' | 'findPersonaVersion' | 'findWorld' | 'findSource' | 'listSourceChunks'>
  /** 人物蒸馏运行、阶段快照和最终确认事实源。 */
  distillations: DistillationRepository
  /** 固定四步算法准备与执行入口。 */
  algorithms: Pick<AiAlgorithmApplicationService, 'prepare' | 'executeStep'>
  /** 新运行、任务、候选、证据和评测标识生成器。 */
  identifiers: IdentifierGenerator
  /** 可测试时钟。 */
  clock: Clock
  /** 候选灵魂发布前 Token 计数器。 */
  tokenCounter: TokenCounter
  /** 人物灵魂硬 Token 上限。 */
  personaSoulTokenBudget: number
  /** 创建运行时固定实际上下文提供器。 */
  context: Pick<ContextProvider, 'getProvider'>
  /** 人物确认后补排资料与 User 对账的可选同步意图。 */
  contextSyncQueue?: Pick<ContextSyncTaskQueue, 'enqueueSourceSynchronization' | 'enqueueUserReconciliation'>
}

/** 创建、推进、审核和确认人物蒸馏运行。 */
export class PersonaDistillationApplicationService implements TaskHandler {
  /**
   * 创建人物蒸馏应用服务。
   * @param dependencies 内容、蒸馏、算法、标识、时间、预算和上下文接缝。
   */
  constructor(private readonly dependencies: PersonaDistillationApplicationServiceDependencies) {}

  /**
   * 创建人物蒸馏运行，固定算法、提供器、用户要求和资料正文快照。
   * @param input 已通过或待通过共享 Schema 的创建输入。
   * @returns 已排队执行资料覆盖评估的运行。
   */
  async createRun(input: CreatePersonaDistillationInput): Promise<PersonaDistillationRunRecord> {
    const parsed = createPersonaDistillationSchema.parse(input)
    if (parsed.worldId) {
      const world = await this.dependencies.content.findWorld(parsed.worldId)
      if (!world) throw new ApplicationError('RESOURCE_NOT_FOUND', '人物蒸馏选择的世界不存在', 404)
      if (!world.isEnabled) throw new ApplicationError('RESOURCE_DISABLED', '人物蒸馏选择的世界已停用', 409)
    }
    return await this.createPreparedRun({
      mode: 'create',
      createdPersonaId: null,
      baseSoulVersionId: null,
      currentSoulPromptText: null,
      requestedName: parsed.requestedName,
      objective: parsed.objective,
      worldId: parsed.worldId,
      sourceIds: parsed.sourceIds,
    })
  }

  /**
   * 固定已有人物的当前灵魂和所选资料，创建更新模式的重新蒸馏运行。
   * @param personaId 将在最终确认时更新的已有人物 UUID。
   * @param input 本次聚焦方向和可选资料标识。
   * @returns 已排队执行资料覆盖评估的更新运行。
   */
  async restartRun(personaId: string, input: RestartPersonaDistillationInput): Promise<PersonaDistillationRunRecord> {
    const parsed = restartPersonaDistillationSchema.parse(input)
    const persona = await this.dependencies.content.findPersona(personaId)
    if (!persona) throw new ApplicationError('RESOURCE_NOT_FOUND', '重新蒸馏的人物不存在', 404)
    if (!persona.activeVersionId) throw new ApplicationError('RESOURCE_NOT_FOUND', '重新蒸馏需要人物已有当前灵魂', 409)
    const activeVersion = await this.dependencies.content.findPersonaVersion(persona.activeVersionId)
    if (!activeVersion || activeVersion.personaId !== persona.id) {
      throw new ApplicationError('VERSION_CONFLICT', '人物当前灵魂版本已变化', 409)
    }
    return await this.createPreparedRun({
      mode: 'update',
      createdPersonaId: persona.id,
      baseSoulVersionId: activeVersion.id,
      currentSoulPromptText: activeVersion.snapshot.promptText,
      requestedName: persona.name,
      objective: parsed.objective,
      worldId: persona.worldId,
      sourceIds: parsed.sourceIds,
    })
  }

  /**
   * 共用创建与更新模式的资料校验、快照组装和任务入队。
   * @param input 已确定模式、目标人物、基线灵魂和资料的内部命令。
   * @returns 已持久化的完整蒸馏运行。
   */
  private async createPreparedRun(input: {
    mode: 'create' | 'update'
    createdPersonaId: string | null
    baseSoulVersionId: string | null
    currentSoulPromptText: string | null
    requestedName: string
    objective: string
    worldId: string | null
    sourceIds: string[]
  }): Promise<PersonaDistillationRunRecord> {
    const sourceIds = [...new Set(input.sourceIds)]
    const sources = await Promise.all(sourceIds.map(async (sourceId) => {
      const source = await this.dependencies.content.findSource(sourceId)
      if (!source) throw new ApplicationError('RESOURCE_NOT_FOUND', '人物蒸馏选择的资料不存在', 404)
      if (!source.isEnabled) throw new ApplicationError('RESOURCE_DISABLED', `资料“${source.name}”已停用`, 409)
      return source
    }))
    const sourceCharacters = sources.reduce((total, source) => total + source.contentText.length, 0)
    if (sourceCharacters > MAX_DISTILLATION_SOURCE_CHARACTERS) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '人物蒸馏资料正文超过 120000 字，请减少资料或先精简正文', 422)
    }
    const algorithmSnapshot = await this.dependencies.algorithms.prepare('persona_distillation')
    const runId = this.dependencies.identifiers.create()
    const timestamp = this.dependencies.clock.now()
    await this.dependencies.distillations.createRun({
      id: runId,
      taskId: this.dependencies.identifiers.create(),
      retryOfRunId: null,
      mode: input.mode,
      createdPersonaId: input.createdPersonaId,
      baseSoulVersionId: input.baseSoulVersionId,
      requestedName: input.requestedName,
      objective: input.objective,
      worldId: input.worldId,
      provider: this.dependencies.context.getProvider(),
      algorithmSnapshot,
      inputs: [
        {
          id: this.dependencies.identifiers.create(),
          inputType: 'user_statement',
          sourceId: null,
          name: input.mode === 'update' ? '本次重新蒸馏要求' : '用户创建要求',
          sourceRole: null,
          sourceRelation: 'user_statement',
          coverageDimensions: [],
          independentSourceKey: `requirement:${runId}`,
          contentHash: hashText(input.objective),
          contentSnapshot: input.objective,
          originUrl: null,
          authorName: null,
          publishedAt: null,
        },
        ...(input.currentSoulPromptText && input.baseSoulVersionId
          ? [{
              id: this.dependencies.identifiers.create(),
              inputType: 'user_statement' as const,
              sourceId: null,
              name: '当前人物灵魂',
              sourceRole: null,
              sourceRelation: 'user_statement' as const,
              coverageDimensions: [],
              independentSourceKey: `soul-version:${input.baseSoulVersionId}`,
              contentHash: hashText(input.currentSoulPromptText),
              contentSnapshot: input.currentSoulPromptText,
              originUrl: null,
              authorName: null,
              publishedAt: null,
            }]
          : []),
        ...sources.map(source => ({
          id: this.dependencies.identifiers.create(),
          inputType: 'source_material' as const,
          sourceId: source.id,
          name: source.name,
          sourceRole: source.role,
          sourceRelation: null,
          coverageDimensions: [],
          independentSourceKey: source.originalSourceKey,
          contentHash: source.contentHash,
          contentSnapshot: source.contentText,
          originUrl: source.originUrl,
          authorName: source.authorName,
          publishedAt: source.publishedAt,
        })),
      ],
      timestamp,
    })
    return await this.requireRun(runId)
  }

  /**
   * 读取一项存在的人物蒸馏运行。
   * @param runId 运行 UUID。
   * @returns 完整可审计运行。
   */
  async getRun(runId: string): Promise<PersonaDistillationRunRecord> {
    return await this.requireRun(runId)
  }

  /**
   * 确认资料范围和分类纠正，并排入认知提取任务。
   * @param runId 运行 UUID。
   * @param input 页面并发版本、接受输入和分类纠正。
   * @returns 已进入认知提取阶段的运行。
   */
  async reviewSources(runId: string, input: ReviewPersonaDistillationSourcesInput): Promise<PersonaDistillationRunRecord> {
    const parsed = reviewPersonaDistillationSourcesSchema.parse(input)
    const run = await this.requireRun(runId)
    const sourceInputIds = new Set(run.inputs.filter(item => item.inputType === 'source_material').map(item => item.id))
    if (parsed.acceptedInputIds.some(id => !sourceInputIds.has(id))
      || parsed.corrections.some(item => !sourceInputIds.has(item.inputId))) {
      throw new ApplicationError('VALIDATION_FAILED', '人物蒸馏资料确认引用了当前运行之外的输入', 400)
    }
    const saved = await this.dependencies.distillations.confirmSources({
      runId,
      expectedUpdatedAt: parsed.expectedUpdatedAt,
      acceptedInputIds: parsed.acceptedInputIds,
      corrections: parsed.corrections,
      taskId: this.dependencies.identifiers.create(),
      timestamp: this.dependencies.clock.now(),
    })
    if (!saved) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏资料审核状态已经变化', 409)
    return await this.requireRun(runId)
  }

  /**
   * 保存人工编辑候选并排入与新正文哈希绑定的重新评测任务。
   * @param runId 运行 UUID。
   * @param input 页面并发版本和完整候选灵魂正文。
   * @returns 已重新进入评测阶段的运行。
   */
  async saveCandidate(runId: string, input: SavePersonaDistillationCandidateInput): Promise<PersonaDistillationRunRecord> {
    const parsed = savePersonaDistillationCandidateSchema.parse(input)
    const saved = await this.dependencies.distillations.saveCandidateForEvaluation({
      runId,
      expectedUpdatedAt: parsed.expectedUpdatedAt,
      candidatePromptText: parsed.promptText,
      candidatePromptHash: hashText(parsed.promptText),
      taskId: this.dependencies.identifiers.create(),
      timestamp: this.dependencies.clock.now(),
    })
    if (!saved) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏候选状态已经变化', 409)
    return await this.requireRun(runId)
  }

  /**
   * 确认当前已通过评测的候选，并原子创建人物或发布已有人物的新灵魂版本。
   * @param runId 运行 UUID。
   * @param input 页面并发版本、最终名称和已评测候选哈希。
   * @returns 已完成人物创建或更新的蒸馏运行。
   */
  async confirmCandidate(runId: string, input: ConfirmPersonaDistillationCandidateInput): Promise<PersonaDistillationRunRecord> {
    const parsed = confirmPersonaDistillationCandidateSchema.parse(input)
    const run = await this.requireRun(runId)
    const hardFailures = run.evaluations
      .filter(item => item.candidatePromptHash === run.candidatePromptHash && item.status === 'failed')
      .flatMap(item => item.failureReasons.length > 0 ? item.failureReasons : [`${item.evaluationType} 评测失败`])
    try {
      assertPersonaDistillationCandidateConfirmable({
        status: run.status,
        candidatePromptHash: run.candidatePromptHash,
        evaluatedPromptHash: run.evaluatedPromptHash,
        hardFailures,
      })
    }
    catch (error: unknown) {
      if (error instanceof PersonaDistillationRuleError) {
        throw new ApplicationError(error.code, error.message, error.code === 'DISTILLATION_EVALUATION_FAILED' ? 422 : 409)
      }
      throw error
    }
    if (!run.candidatePromptText) throw new ApplicationError('DISTILLATION_CANDIDATE_NOT_EVALUATED', '人物候选正文不存在', 409)
    const count = this.dependencies.tokenCounter.count(null, run.candidatePromptText)
    if (count.tokens > this.dependencies.personaSoulTokenBudget) {
      throw new ApplicationError('SOUL_TOKEN_BUDGET_EXCEEDED', `人物灵魂预计 ${count.tokens} Token，超过当前 ${this.dependencies.personaSoulTokenBudget} Token 限制`, 422)
    }
    const targetPersonaId = run.mode === 'update' ? run.createdPersonaId : this.dependencies.identifiers.create()
    if (!targetPersonaId || (run.mode === 'update' && !run.baseSoulVersionId)) {
      throw new ApplicationError('VERSION_CONFLICT', '重新蒸馏的目标人物或基线灵魂已变化', 409)
    }
    const confirmed = await this.dependencies.distillations.confirmCandidate({
      runId,
      expectedUpdatedAt: parsed.expectedUpdatedAt,
      expectedPromptHash: parsed.expectedPromptHash,
      personaId: targetPersonaId,
      soulVersionId: this.dependencies.identifiers.create(),
      name: parsed.name,
      runtimeTokenCount: count.tokens,
      tokenCounter: count.counter,
      timestamp: this.dependencies.clock.now(),
    })
    if (!confirmed) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏候选确认状态已经变化', 409)
    const completed = await this.requireRun(runId)
    await this.enqueueConfirmedSources(completed)
    return completed
  }

  /**
   * 请求协作式取消人物蒸馏运行。
   * @param runId 运行 UUID。
   * @returns 取消请求后的运行。
   */
  async cancelRun(runId: string): Promise<PersonaDistillationRunRecord> {
    if (!await this.dependencies.distillations.requestCancellation(runId, this.dependencies.clock.now())) {
      throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '当前人物蒸馏状态不能取消', 409)
    }
    return await this.requireRun(runId)
  }

  /**
   * 从失败运行的固定输入和算法快照创建新重试运行。
   * @param runId 失败运行 UUID。
   * @returns 新资料评估运行。
   */
  async retryRun(runId: string): Promise<PersonaDistillationRunRecord> {
    const source = await this.requireRun(runId)
    const newRunId = this.dependencies.identifiers.create()
    const retried = await this.dependencies.distillations.createRetry({
      sourceRunId: runId,
      runId: newRunId,
      taskId: this.dependencies.identifiers.create(),
      inputIds: source.inputs.map(() => this.dependencies.identifiers.create()),
      timestamp: this.dependencies.clock.now(),
    })
    if (!retried) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏运行不可重试或原输入已不可用', 409)
    return await this.requireRun(newRunId)
  }

  /**
   * 由前台 Worker 按运行当前状态恢复并推进固定人物蒸馏步骤。
   * @param job 已领取的人物蒸馏任务。
   * @returns 当前任务推进到人工检查点或终态时结束。
   */
  async execute(job: TaskJob): Promise<void> {
    if (job.type !== 'distill_persona') throw new TaskExecutionError('未知人物蒸馏任务', false)
    const runId = readDistillationRunId(job.payloadJson)
    try {
      if (await this.stopIfCancellationRequested(runId)) return
      let run = await this.requireRun(runId)
      if (run.status === 'assessing_sources') {
        await this.executeSourceAssessment(run)
        return
      }
      if (run.status === 'extracting') {
        await this.executeExtraction(run)
        if (await this.stopIfCancellationRequested(runId)) return
        run = await this.requireRun(runId)
      }
      if (run.status === 'synthesizing') {
        await this.executeSynthesis(run)
        if (await this.stopIfCancellationRequested(runId)) return
        run = await this.requireRun(runId)
      }
      if (run.status === 'evaluating') await this.executeEvaluation(run)
    }
    catch (error: unknown) {
      const normalized = normalizeDistillationError(error)
      await this.dependencies.distillations.failRun(runId, normalized.code, normalized.message, this.dependencies.clock.now())
      throw new TaskExecutionError(normalized.message, normalized.retryable)
    }
  }

  /** @param run 当前资料评估运行。 @returns 覆盖快照保存完成时结束。 */
  private async executeSourceAssessment(run: PersonaDistillationRunRecord): Promise<void> {
    const sources = run.inputs.filter(input => input.inputType === 'source_material' && input.contentSnapshot !== null)
    if (sources.length === 0) {
      const saved = await this.dependencies.distillations.saveSourceAssessment({
        runId: run.id,
        assessment: { sources: [] },
        coverage: buildPersonaDistillationCoverage([]),
        timestamp: this.dependencies.clock.now(),
      })
      if (!saved) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏资料评估状态已经变化', 409)
      return
    }
    const response = await this.dependencies.algorithms.executeStep(
      run.algorithmSnapshot as AiAlgorithmSnapshot,
      'classify_sources',
      {
        objectiveJson: JSON.stringify(run.objective),
        inputsJson: JSON.stringify(sources.map(toModelInput)),
      },
      'persona_distillation_source_assessment',
      'json_object',
      { validateStructuredOutput: value => { modelPersonaDistillationSourceAssessmentSchema.parse(value) } },
    )
    if (await this.stopIfCancellationRequested(run.id)) return
    const assessment = modelPersonaDistillationSourceAssessmentSchema.parse(response.structuredOutput)
    validatePersonaDistillationSourceAssessment(assessment, sources.map(source => source.id))
    const inputById = new Map(sources.map(source => [source.id, source]))
    const normalizedAssessment = {
      sources: assessment.sources.map((classified) => {
        const input = inputById.get(classified.inputId)
        return {
          ...classified,
          // 明确提供的原始来源键属于可审计事实；缺失时才采用模型的同源判断。
          independentSourceKey: input?.independentSourceKey ?? classified.independentSourceKey,
        }
      }),
    }
    const assessmentByInput = new Map(normalizedAssessment.sources.map(source => [source.inputId, source]))
    const coverageInputs: PersonaDistillationInput[] = sources.map((source) => {
      const classified = assessmentByInput.get(source.id)
      if (!classified || !source.contentSnapshot) throw new ApplicationError('DISTILLATION_SOURCE_ASSESSMENT_INVALID', '人物蒸馏资料分类缺少输入', 502)
      return {
        id: source.id,
        sourceRelation: classified.sourceRelation,
        coverageDimensions: classified.coverageDimensions,
        independentSourceKey: classified.independentSourceKey,
        content: source.contentSnapshot,
      }
    })
    if (!await this.dependencies.distillations.saveSourceAssessment({
      runId: run.id,
      assessment: normalizedAssessment,
      coverage: buildPersonaDistillationCoverage(coverageInputs),
      timestamp: this.dependencies.clock.now(),
    })) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏资料评估状态已经变化', 409)
  }

  /** @param run 当前认知提取运行。 @returns 候选、证据和质量门禁保存完成时结束。 */
  private async executeExtraction(run: PersonaDistillationRunRecord): Promise<void> {
    const inputs = run.inputs.filter(input => input.accepted && input.sourceAvailable && input.contentSnapshot !== null)
    const validationInputs: PersonaDistillationInput[] = inputs.map(input => ({
      id: input.id,
      sourceRelation: input.sourceRelation ?? 'third_party',
      coverageDimensions: input.coverageDimensions,
      independentSourceKey: input.independentSourceKey ?? input.id,
      content: input.contentSnapshot ?? '',
    }))
    const response = await this.dependencies.algorithms.executeStep(
      run.algorithmSnapshot as AiAlgorithmSnapshot,
      'extract_claims',
      {
        objectiveJson: JSON.stringify(run.objective),
        coverageJson: JSON.stringify(run.coverageSnapshot),
        inputsJson: JSON.stringify(inputs.map(toModelInput)),
      },
      'persona_distillation_claims',
      'json_object',
      {
        validateStructuredOutput: (value) => {
          const parsed = modelPersonaDistillationExtractionSchema.parse(value)
          validateAndMergePersonaDistillationClaims(
            normalizeUserStatementEvidenceQuotes(parsed, run.inputs).claims,
            validationInputs,
          )
        },
      },
    )
    if (await this.stopIfCancellationRequested(run.id)) return
    const rawExtraction = modelPersonaDistillationExtractionSchema.parse(response.structuredOutput)
    const extracted = normalizeUserStatementEvidenceQuotes(rawExtraction, run.inputs)
    const validated = validateAndMergePersonaDistillationClaims(extracted.claims, validationInputs)
    const coverage = buildPersonaDistillationCoverage(inputs
      .filter(input => input.inputType === 'source_material')
      .map(input => ({
        id: input.id,
        sourceRelation: input.sourceRelation ?? 'third_party',
        coverageDimensions: input.coverageDimensions,
        independentSourceKey: input.independentSourceKey ?? input.id,
        content: input.contentSnapshot ?? '',
      })))
    const qualityGate = buildPersonaDistillationQualityGate(coverage, validated)
    if (qualityGate.hardFailures.length > 0) {
      throw new ApplicationError('DISTILLATION_NO_VALID_CLAIMS', qualityGate.hardFailures.join('；'), 422)
    }
    const claims: PersonaDistillationClaimRecord[] = validated.map(claim => ({
      ...claim,
      id: this.dependencies.identifiers.create(),
      evidence: claim.evidence.map(evidence => ({
        ...evidence,
        id: this.dependencies.identifiers.create(),
        quoteHash: hashText(evidence.quote),
      })),
    }))
    if (!await this.dependencies.distillations.saveExtraction({
      runId: run.id,
      rawExtraction,
      claims,
      qualityGate,
      timestamp: this.dependencies.clock.now(),
    })) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏认知提取状态已经变化', 409)
  }

  /** @param run 当前灵魂综合运行。 @returns 完整候选正文和哈希保存完成时结束。 */
  private async executeSynthesis(run: PersonaDistillationRunRecord): Promise<void> {
    const usableClaims = run.claims.filter(claim => claim.status !== 'rejected')
    const response = await this.dependencies.algorithms.executeStep(
      run.algorithmSnapshot as AiAlgorithmSnapshot,
      'synthesize_soul',
      {
        objectiveJson: JSON.stringify(run.objective),
        coverageJson: JSON.stringify(run.coverageSnapshot),
        claimsJson: JSON.stringify(usableClaims),
      },
      'persona_distillation_soul',
      'json_object',
      { validateStructuredOutput: value => { personaDraftSchema.parse(value) } },
    )
    if (await this.stopIfCancellationRequested(run.id)) return
    const candidate = personaDraftSchema.parse(response.structuredOutput)
    if (!await this.dependencies.distillations.saveSynthesis({
      runId: run.id,
      candidateName: candidate.name,
      candidatePromptText: candidate.snapshot.promptText,
      candidatePromptHash: hashText(candidate.snapshot.promptText),
      timestamp: this.dependencies.clock.now(),
    })) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏灵魂综合状态已经变化', 409)
  }

  /** @param run 当前候选评测运行。 @returns 六类评测和通过哈希保存完成时结束。 */
  private async executeEvaluation(run: PersonaDistillationRunRecord): Promise<void> {
    if (!run.candidatePromptText || !run.candidatePromptHash) {
      throw new ApplicationError('DISTILLATION_CANDIDATE_NOT_EVALUATED', '人物蒸馏缺少待评测候选', 409)
    }
    const response = await this.dependencies.algorithms.executeStep(
      run.algorithmSnapshot as AiAlgorithmSnapshot,
      'evaluate_soul',
      {
        objectiveJson: JSON.stringify(run.objective),
        candidatePromptJson: JSON.stringify(run.candidatePromptText),
        claimsJson: JSON.stringify(run.claims.filter(claim => claim.status !== 'rejected')),
      },
      'persona_distillation_evaluation',
      'json_object',
      { validateStructuredOutput: value => { modelPersonaDistillationEvaluationSchema.parse(value) } },
    )
    if (await this.stopIfCancellationRequested(run.id)) return
    const result = modelPersonaDistillationEvaluationSchema.parse(response.structuredOutput)
    const roundNo = Math.max(0, ...run.evaluations.map(item => item.roundNo)) + 1
    const hardFailures = result.evaluations
      .filter(item => item.status === 'failed')
      .flatMap(item => item.failureReasons.length > 0 ? item.failureReasons : [item.summary])
    if (!await this.dependencies.distillations.saveEvaluation({
      runId: run.id,
      candidatePromptHash: run.candidatePromptHash,
      evaluations: result.evaluations.map(evaluation => ({
        id: this.dependencies.identifiers.create(),
        roundNo,
        evaluationType: evaluation.evaluationType,
        input: { objective: run.objective },
        expected: { evaluationType: evaluation.evaluationType },
        output: { summary: evaluation.summary },
        status: evaluation.status,
        score: evaluation.score,
        failureReasons: evaluation.failureReasons,
      })),
      hardFailures,
      timestamp: this.dependencies.clock.now(),
    })) throw new ApplicationError('DISTILLATION_STATE_CONFLICT', '人物蒸馏候选评测状态已经变化', 409)
  }

  /** @param runId 运行 UUID。 @returns 存在时返回运行，否则抛出稳定错误。 */
  private async requireRun(runId: string): Promise<PersonaDistillationRunRecord> {
    const run = await this.dependencies.distillations.findRun(runId)
    if (!run) throw new ApplicationError('DISTILLATION_NOT_FOUND', '人物蒸馏运行不存在', 404)
    return run
  }

  /** @param runId 运行 UUID。 @returns 已请求取消并完成安全取消时为 true。 */
  private async stopIfCancellationRequested(runId: string): Promise<boolean> {
    if (!await this.dependencies.distillations.isCancellationRequested(runId)) return false
    await this.dependencies.distillations.markRunCanceled(runId, this.dependencies.clock.now())
    return true
  }

  /** @param run 已完成人物创建的运行。 @returns OpenViking 补偿意图保存完成时结束。 */
  private async enqueueConfirmedSources(run: PersonaDistillationRunRecord): Promise<void> {
    const queue = this.dependencies.contextSyncQueue
    if (!queue) return
    const timestamp = this.dependencies.clock.now()
    const sourceIds = [...new Set(run.inputs
      .filter(input => input.inputType === 'source_material' && input.accepted && input.sourceAvailable && input.sourceId)
      .map(input => input.sourceId)
      .filter((sourceId): sourceId is string => sourceId !== null))]
    for (const sourceId of sourceIds) {
      await queue.enqueueSourceSynchronization(sourceId, this.dependencies.identifiers.create(), timestamp)
    }
    await queue.enqueueUserReconciliation(this.dependencies.identifiers.create(), timestamp)
  }
}

/** @param input 持久化输入。 @returns 只包含模型所需字段的不可信输入。 */
function toModelInput(input: PersonaDistillationRunRecord['inputs'][number]) {
  return {
    id: input.id,
    inputType: input.inputType,
    name: input.name,
    sourceRole: input.sourceRole,
    sourceRelation: input.sourceRelation,
    coverageDimensions: input.coverageDimensions,
    independentSourceKey: input.independentSourceKey,
    content: input.contentSnapshot,
    originUrl: input.originUrl,
    authorName: input.authorName,
    publishedAt: input.publishedAt,
  }
}

/**
 * 将用户本次明确要求的证据引文固定为完整原文，避免模型改写导致无法定位。
 * @param extraction 模型返回且已通过结构校验的认知提取结果。
 * @param inputs 本次运行的不可变输入快照。
 * @returns 只规范本次要求引文；基线灵魂和外部资料仍要求精确定位的提取结果。
 */
function normalizeUserStatementEvidenceQuotes(
  extraction: ModelPersonaDistillationExtraction,
  inputs: PersonaDistillationRunRecord['inputs'],
): ModelPersonaDistillationExtraction {
  const userStatements = new Map(inputs
    .filter(input => input.inputType === 'user_statement'
      && input.independentSourceKey?.startsWith('requirement:')
      && input.contentSnapshot !== null)
    .map(input => [input.id, input.contentSnapshot ?? '']))
  return {
    claims: extraction.claims.map(claim => ({
      ...claim,
      evidence: claim.evidence.map((evidence) => {
        const statement = userStatements.get(evidence.inputId)
        return statement === undefined ? evidence : { ...evidence, quote: statement }
      }),
    })),
  }
}

/** @param value UTF-8 文本。 @returns 小写十六进制 SHA-256。 */
function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** @param payloadJson 任务载荷。 @returns 人物蒸馏运行 UUID。 */
function readDistillationRunId(payloadJson: string): string {
  try {
    const parsed = JSON.parse(payloadJson) as unknown
    if (!parsed || typeof parsed !== 'object' || !('distillationRunId' in parsed)
      || typeof parsed.distillationRunId !== 'string') throw new Error('invalid')
    return parsed.distillationRunId
  }
  catch {
    throw new TaskExecutionError('人物蒸馏任务载荷无效', false)
  }
}

/** @param error 未知执行错误。 @returns 可安全持久化的错误码、说明和重试语义。 */
function normalizeDistillationError(error: unknown): { code: string, message: string, retryable: boolean } {
  if (error instanceof TextModelError) return { code: error.code, message: error.message, retryable: error.retryable }
  if (error instanceof PersonaDistillationRuleError) return { code: error.code, message: error.message, retryable: false }
  if (error instanceof ApplicationError) return { code: error.code, message: error.message, retryable: error.statusCode >= 500 }
  return { code: 'MODEL_OUTPUT_INVALID', message: '人物蒸馏模型输出或执行结果无效', retryable: false }
}
