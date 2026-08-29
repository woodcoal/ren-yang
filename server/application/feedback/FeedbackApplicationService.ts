import { ZodError } from 'zod'
import { personaSnapshotSchema } from '../../../shared/schemas/content'
import {
  evaluationModelOutputSchema,
  feedbackClassificationSuggestionSchema,
  type ConfirmFeedbackClassificationInput,
  type CreateEvaluationCaseInput,
  type SubmitFeedbackInput,
} from '../../../shared/schemas/feedback'
import type {
  CandidateMemoryView,
  EvaluationCaseView,
  EvaluationResultView,
  EvaluationRunView,
  FeedbackView,
  RevisionProposalView,
  CreatedEvaluationRun,
} from '../../../shared/types/feedback'
import type {
  EvaluationCaseRecord,
  EvaluationResultRecord,
  RevisionPatchRecord,
  RevisionProposalRecord,
} from '../../domain/feedback/FeedbackModels'
import { assessRevisionRisk, decideRevisionPublication } from '../../domain/feedback/RevisionPolicy'
import type { Clock } from '../../ports/Clock'
import type { FeedbackAggregate, FeedbackRepository } from '../../ports/FeedbackRepository'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { TextModelPort } from '../../ports/TextModelPort'
import { TextModelError } from '../../ports/TextModelPort'
import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { TaskHandler } from '../../ports/TaskPorts'
import { TaskExecutionError } from '../../ports/TaskPorts'
import { ApplicationError } from '../errors/ApplicationError'
import {
  buildFeedbackClassificationPrompt,
  buildPersonaEvaluationPrompt,
  FEEDBACK_CLASSIFICATION_PROMPT_VERSION,
  PERSONA_EVALUATION_PROMPT_VERSION,
} from './FeedbackPromptBuilder'

/** 反馈分类和人物评测固定使用的确定性模型参数。 */
export const FEEDBACK_MODEL_PARAMETERS = {
  temperature: 0,
  maxOutputTokens: 4_096,
  timeoutMs: 60_000,
  maxEvidenceChunks: 0,
  maxTextBlocks: 1,
}

/** 反馈、提案和评测应用服务依赖。 */
export interface FeedbackApplicationServiceDependencies {
  /** 反馈与人物版本事务事实源。 */
  repository: FeedbackRepository
  /** 固定分类和评测文本模型。 */
  model: TextModelPort
  /** UUID 生成端口。 */
  identifiers: IdentifierGenerator
  /** 可测试时钟。 */
  clock: Clock
  /** 是否允许评测通过后自动发布低风险提案。 */
  autoPublishLowRisk: boolean
}

/** 编排反馈归因、修订提案、人物评测和受控发布。 */
export class FeedbackApplicationService implements TaskHandler {
  /**
   * 创建反馈应用服务。
   * @param dependencies 数据、模型、标识、时钟和自动发布设置。
   */
  constructor(private readonly dependencies: FeedbackApplicationServiceDependencies) {}

  /** @returns 新反馈在前的完整反馈历史。 */
  async listFeedback(): Promise<FeedbackView[]> {
    return (await this.dependencies.repository.listFeedback()).map(toFeedbackView)
  }

  /**
   * 调用固定文本模型建议反馈目标，并把原始事件和建议一并保存。
   * @param runId 反馈所属运行 UUID。
   * @param input 已通过共享 Schema 校验的原始反馈。
   * @returns 尚待用户确认的反馈视图。
   */
  async submitFeedback(runId: string, input: SubmitFeedbackInput): Promise<FeedbackView> {
    if (!await this.dependencies.repository.findRunPersonaVersion(runId)) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '反馈所属运行不存在', 404)
    }
    const model = this.requireModel()
    const blockId = input.blockId ?? null
    const prompt = buildFeedbackClassificationPrompt({
      content: input.content,
      blockId,
      isLongTerm: input.isLongTerm,
      editedOutput: input.editedOutput ?? null,
    })
    let suggestion
    try {
      const response = await this.dependencies.model.generateStructured({
        ...prompt,
        parameters: FEEDBACK_MODEL_PARAMETERS,
        responseSchemaName: 'feedback_classification',
      })
      suggestion = feedbackClassificationSuggestionSchema.parse(response.structuredOutput)
    }
    catch (error: unknown) {
      throw toModelApplicationError(error)
    }

    const timestamp = this.dependencies.clock.now()
    const feedbackId = this.dependencies.identifiers.create()
    const created = await this.dependencies.repository.createFeedback(
      {
        id: feedbackId,
        runId,
        blockId,
        content: input.content,
        rating: input.rating ?? null,
        isLongTerm: input.isLongTerm,
        editedOutput: input.editedOutput ?? null,
        createdAt: timestamp,
      },
      {
        feedbackId,
        ...suggestion,
        modelSnapshot: model,
        parameterSnapshot: FEEDBACK_MODEL_PARAMETERS,
        promptVersion: FEEDBACK_CLASSIFICATION_PROMPT_VERSION,
        createdAt: timestamp,
      },
    )
    if (!created) throw new ApplicationError('RESOURCE_NOT_FOUND', '反馈目标产物块不属于当前运行', 404)
    return toFeedbackView((await this.dependencies.repository.findFeedback(feedbackId))!)
  }

  /**
   * 确认或纠正反馈目标，并且只执行该目标允许的业务动作。
   * @param feedbackId 反馈 UUID。
   * @param input 已确认目标及其必要参数。
   * @returns 保存动作结果后的反馈视图。
   */
  async confirmClassification(feedbackId: string, input: ConfirmFeedbackClassificationInput): Promise<FeedbackView> {
    const aggregate = await this.requireFeedback(feedbackId)
    if (aggregate.resolution) throw new ApplicationError('FEEDBACK_ALREADY_CLASSIFIED', '该反馈已经确认分类', 409)
    const timestamp = this.dependencies.clock.now()

    if (input.targetType === 'artifact') {
      const blockId = input.blockId ?? aggregate.event.blockId
      if (!blockId) throw new ApplicationError('VALIDATION_FAILED', '当前产物反馈必须指定产物块', 400)
      const accepted = await this.dependencies.repository.confirmArtifactFeedback(
        feedbackId,
        blockId,
        this.dependencies.identifiers.create(),
        timestamp,
      )
      if (!accepted) throw new ApplicationError('BLOCK_NOT_RETRYABLE', '目标块不存在、已锁定或当前不能重试', 409)
    }
    else if (input.targetType === 'parameters') {
      const accepted = await this.dependencies.repository.confirmSimpleFeedback(feedbackId, 'parameters', {
        recommendation: aggregate.event.content,
        scope: 'next_run_override',
      }, timestamp)
      if (!accepted) throw new ApplicationError('VERSION_CONFLICT', '反馈状态已经变化，请刷新后重试', 409)
    }
    else if (input.targetType === 'source_fact') {
      if (!input.sourceId || !await this.dependencies.repository.sourceExists(input.sourceId)) {
        throw new ApplicationError('RESOURCE_NOT_FOUND', '资料事实反馈必须指定有效资料', 404)
      }
      const accepted = await this.dependencies.repository.confirmSimpleFeedback(feedbackId, 'source_fact', {
        sourceId: input.sourceId,
        conflict: input.hasEvidenceConflict,
        recommendation: aggregate.event.content,
        automaticPersonaChange: false,
      }, timestamp)
      if (!accepted) throw new ApplicationError('VERSION_CONFLICT', '反馈状态已经变化，请刷新后重试', 409)
    }
    else {
      await this.createPersonaProposal(aggregate, input, timestamp)
    }

    return toFeedbackView((await this.dependencies.repository.findFeedback(feedbackId))!)
  }

  /** @param filter 可选人物和状态筛选。 @returns 新提案在前的列表。 */
  async listRevisionProposals(filter: { personaId?: string, status?: RevisionProposalRecord['status'] }): Promise<RevisionProposalView[]> {
    return (await this.dependencies.repository.listRevisionProposals(filter)).map(toProposalView)
  }

  /** @param proposalId 提案 UUID。 @returns 完整提案。 */
  async getRevisionProposal(proposalId: string): Promise<RevisionProposalView> {
    return toProposalView(await this.requireProposal(proposalId))
  }

  /** @param feedbackId 反馈 UUID。 @returns 该反馈形成的候选记忆或 null。 */
  async getCandidateMemory(feedbackId: string): Promise<CandidateMemoryView | null> {
    const value = await this.dependencies.repository.findCandidateMemory(feedbackId)
    return value ? { ...value } : null
  }

  /**
   * 为人物添加一个固定且不可原地修改的回归用例。
   * @param personaId 人物 UUID。
   * @param input 已校验用例输入。
   * @returns 新评测用例。
   */
  async createEvaluationCase(personaId: string, input: CreateEvaluationCaseInput): Promise<EvaluationCaseView> {
    if (!await this.dependencies.repository.personaExists(personaId)) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '人物不存在', 404)
    }
    const cases = await this.dependencies.repository.listEvaluationCases(personaId)
    if (cases.filter(item => item.isActive).length >= 10) {
      throw new ApplicationError('TASK_LIMIT_EXCEEDED', '每个人物最多维护 10 个活动评测用例', 422)
    }
    const record: EvaluationCaseRecord = {
      id: this.dependencies.identifiers.create(),
      personaId,
      name: input.name,
      category: input.category,
      prompt: input.prompt,
      expectedChange: input.expectedChange,
      requiredTerms: input.requiredTerms,
      forbiddenTerms: input.forbiddenTerms,
      minimumScore: input.minimumScore,
      maxRegression: input.maxRegression,
      isActive: true,
      createdAt: this.dependencies.clock.now(),
    }
    try {
      await this.dependencies.repository.createEvaluationCase(record)
    }
    catch (error: unknown) {
      if (isUniqueConstraintError(error)) throw new ApplicationError('VERSION_CONFLICT', '人物内评测用例名称不能重复', 409)
      throw error
    }
    return record
  }

  /** @param personaId 人物 UUID。 @returns 人物全部评测用例。 */
  async listEvaluationCases(personaId: string): Promise<EvaluationCaseView[]> {
    if (!await this.dependencies.repository.personaExists(personaId)) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', '人物不存在', 404)
    }
    return await this.dependencies.repository.listEvaluationCases(personaId)
  }

  /**
   * 固定评测输入并原子创建持久评测任务，HTTP 请求不等待模型调用。
   * @param proposalId 修订提案 UUID。
   * @returns 评测运行、任务和排队状态。
   */
  async enqueueProposalEvaluation(proposalId: string): Promise<CreatedEvaluationRun> {
    const proposal = await this.requireProposal(proposalId)
    if (['published', 'rejected'].includes(proposal.status)) {
      throw new ApplicationError('VERSION_CONFLICT', '已发布或已拒绝的提案不能重新评测', 409)
    }
    const cases = (await this.dependencies.repository.listEvaluationCases(proposal.personaId)).filter(item => item.isActive)
    if (cases.length === 0) throw new ApplicationError('EVALUATION_CASES_REQUIRED', '至少需要一个活动评测用例', 422)
    const model = this.requireModel()
    const timestamp = this.dependencies.clock.now()
    const evaluationRunId = this.dependencies.identifiers.create()
    const taskId = this.dependencies.identifiers.create()
    const started = await this.dependencies.repository.createEvaluationRun({
      id: evaluationRunId,
      proposalId,
      candidateVersionId: proposal.candidateVersionId,
      status: 'queued',
      modelSnapshot: model,
      parameterSnapshot: FEEDBACK_MODEL_PARAMETERS,
      promptVersion: PERSONA_EVALUATION_PROMPT_VERSION,
      passedCases: 0,
      totalCases: cases.length,
      errorCode: null,
      errorMessage: null,
      createdAt: timestamp,
      completedAt: null,
    }, taskId)
    if (!started) throw new ApplicationError('VERSION_CONFLICT', '提案状态已经变化或已有评测正在运行', 409)
    return { evaluationRunId, taskId, status: 'queued' }
  }

  /**
   * 执行 Worker 已领取的评测任务，并按任务尝试次数恢复或终止评测运行。
   * @param job 已领取的 evaluate_proposal 任务。
   * @returns 评测和可选自动发布完成时结束。
   */
  async execute(job: TaskJob): Promise<void> {
    if (job.type !== 'evaluate_proposal') throw new Error(`反馈服务未注册任务类型：${job.type}`)
    const evaluationRunId = readEvaluationRunId(job.payloadJson)
    try {
      await this.executeEvaluationRun(evaluationRunId)
    }
    catch (error: unknown) {
      const normalized = normalizeEvaluationError(error)
      const willRetry = normalized.retryable && job.attemptCount < job.maxAttempts
      if (willRetry) await this.dependencies.repository.prepareEvaluationRetry(evaluationRunId)
      else await this.dependencies.repository.failEvaluationRun(
        evaluationRunId,
        normalized.code,
        normalized.message,
        this.dependencies.clock.now(),
      )
      throw new TaskExecutionError(`${normalized.code}：${normalized.message}`, normalized.retryable)
    }
  }

  /**
   * 使用运行中已固定的模型和用例逐项比较人物版本。
   * @param evaluationRunId 已排队评测运行 UUID。
   * @returns 逐用例保存和发布门禁处理完成时结束。
   */
  private async executeEvaluationRun(evaluationRunId: string): Promise<void> {
    const aggregate = await this.dependencies.repository.findEvaluationRun(evaluationRunId)
    if (!aggregate || !['queued', 'running'].includes(aggregate.run.status)) throw new Error('评测运行不存在或状态不允许执行')
    const proposal = await this.requireProposal(aggregate.run.proposalId)
    const cases = (await this.dependencies.repository.listEvaluationCases(proposal.personaId)).filter(item => item.isActive)
    if (cases.length !== aggregate.run.totalCases) throw new Error('评测用例集合在排队后发生变化')
    const [base, candidate] = await Promise.all([
      this.dependencies.repository.findPersonaVersionSnapshot(proposal.baseVersionId),
      this.dependencies.repository.findPersonaVersionSnapshot(proposal.candidateVersionId),
    ])
    if (!base || !candidate || base.personaId !== proposal.personaId || candidate.personaId !== proposal.personaId) {
      throw new Error('提案关联的人物版本不存在')
    }
    const configuredModel = this.requireModel()
    if (JSON.stringify(configuredModel) !== JSON.stringify(aggregate.run.modelSnapshot)) {
      throw new Error('当前评测模型配置与排队快照不一致')
    }
    if (!await this.dependencies.repository.startEvaluationRun(evaluationRunId)) {
      throw new Error('评测运行状态已经变化')
    }

    const results: EvaluationResultRecord[] = []
    for (const evaluationCase of cases) {
      const prompt = buildPersonaEvaluationPrompt(base.snapshot, candidate.snapshot, evaluationCase)
      const response = await this.dependencies.model.generateStructured({
        ...prompt,
        parameters: aggregate.run.parameterSnapshot,
        responseSchemaName: 'persona_evaluation_case',
      })
      const output = evaluationModelOutputSchema.parse(response.structuredOutput)
      const failures = evaluateCaseRules(evaluationCase, output)
      results.push({
        id: this.dependencies.identifiers.create(),
        evaluationRunId,
        caseId: evaluationCase.id,
        caseName: evaluationCase.name,
        status: failures.length === 0 ? 'passed' : 'failed',
        baseScore: output.baseScore,
        candidateScore: output.candidateScore,
        baseOutput: output.baseOutput,
        candidateOutput: output.candidateOutput,
        failures,
        reasoningSummary: output.reasoningSummary,
      })
    }

    const status = results.every(result => result.status === 'passed') ? 'passed' : 'failed'
    await this.dependencies.repository.completeEvaluationRun(evaluationRunId, results, status, this.dependencies.clock.now())
    if (status === 'passed') await this.tryAutomaticPublication(proposal)
  }

  /** @param evaluationRunId 评测运行 UUID。 @returns 固定输入和逐用例结果。 */
  async getEvaluationRun(evaluationRunId: string): Promise<EvaluationRunView> {
    const aggregate = await this.dependencies.repository.findEvaluationRun(evaluationRunId)
    if (!aggregate) throw new ApplicationError('RESOURCE_NOT_FOUND', '评测运行不存在', 404)
    return {
      id: aggregate.run.id,
      proposalId: aggregate.run.proposalId,
      candidateVersionId: aggregate.run.candidateVersionId,
      status: aggregate.run.status,
      model: aggregate.run.modelSnapshot,
      promptVersion: aggregate.run.promptVersion,
      results: aggregate.results.map(toEvaluationResultView),
      passedCases: aggregate.run.passedCases,
      totalCases: aggregate.run.totalCases,
      createdAt: aggregate.run.createdAt,
      completedAt: aggregate.run.completedAt,
    }
  }

  /**
   * 在评测通过且基础版本未变化时执行明确人工发布。
   * @param proposalId 提案 UUID。
   * @returns 发布后的提案。
   */
  async publishProposal(proposalId: string): Promise<RevisionProposalView> {
    const proposal = await this.requireProposal(proposalId)
    const activeVersionId = await this.dependencies.repository.findPersonaActiveVersionId(proposal.personaId)
    const decision = decideRevisionPublication({
      riskLevel: proposal.riskLevel,
      evaluationStatus: proposal.status === 'ready' ? 'passed' : proposal.status === 'evaluation_failed' ? 'failed' : 'not_run',
      baseVersionIsActive: activeVersionId === proposal.baseVersionId,
      hasEvidenceConflict: proposal.hasEvidenceConflict,
      autoPublishEnabled: this.dependencies.autoPublishLowRisk,
      manualConfirmation: true,
    })
    if (decision.action === 'blocked') throw new ApplicationError('REVISION_PUBLICATION_BLOCKED', decision.reason, 409)
    if (decision.action !== 'manual_publish') throw new ApplicationError('REVISION_PUBLICATION_BLOCKED', decision.reason, 409)
    const result = await this.dependencies.repository.publishProposal(proposalId, decision.reason, this.dependencies.clock.now(), 'administrator')
    if (result !== 'published') throw publicationResultError(result)
    return toProposalView(await this.requireProposal(proposalId))
  }

  /** @param proposalId 提案 UUID。 @param reason 明确拒绝原因。 @returns 拒绝后的提案。 */
  async rejectProposal(proposalId: string, reason: string): Promise<RevisionProposalView> {
    await this.requireProposal(proposalId)
    const rejected = await this.dependencies.repository.rejectProposal(proposalId, reason, this.dependencies.clock.now())
    if (!rejected) throw new ApplicationError('VERSION_CONFLICT', '提案已经发布、拒绝或不存在', 409)
    return toProposalView(await this.requireProposal(proposalId))
  }

  /**
   * 生成候选快照并原子保存候选版本、候选记忆、提案和反馈确认。
   * @param aggregate 尚未确认的反馈聚合。
   * @param input 长期人物分类和字段补丁。
   * @param timestamp 统一创建时间。
   * @returns 创建完成时结束。
   */
  private async createPersonaProposal(
    aggregate: FeedbackAggregate,
    input: ConfirmFeedbackClassificationInput,
    timestamp: number,
  ): Promise<void> {
    if (input.personaPatches.length === 0) {
      throw new ApplicationError('VALIDATION_FAILED', '长期人物反馈至少需要一个字段补丁', 400)
    }
    const runPersona = await this.dependencies.repository.findRunPersonaVersion(aggregate.event.runId)
    if (!runPersona) throw new ApplicationError('RESOURCE_NOT_FOUND', '反馈所属运行或人物版本不存在', 404)
    let risk
    try {
      risk = assessRevisionRisk(runPersona.snapshot, input.personaPatches)
    }
    catch (error: unknown) {
      throw new ApplicationError('VALIDATION_FAILED', error instanceof Error ? error.message : '人物修订补丁无效', 400)
    }
    const patches: RevisionPatchRecord[] = input.personaPatches.map(patch => ({
      field: patch.field,
      before: runPersona.snapshot[patch.field],
      after: patch.after,
      reason: patch.reason,
    }))
    const candidateSnapshot = personaSnapshotSchema.parse({
      ...runPersona.snapshot,
      ...Object.fromEntries(patches.map(patch => [patch.field, patch.after])),
    })
    const proposalId = this.dependencies.identifiers.create()
    const candidateVersionId = this.dependencies.identifiers.create()
    const accepted = await this.dependencies.repository.createRevisionProposal({
      feedbackId: aggregate.event.id,
      resolutionTarget: 'persona',
      resolution: { proposalId, candidateVersionId },
      memoryId: this.dependencies.identifiers.create(),
      proposalId,
      personaId: runPersona.personaId,
      baseVersionId: runPersona.personaVersionId,
      candidateVersionId,
      candidateSnapshot,
      patches,
      riskLevel: risk.riskLevel,
      riskReasons: risk.reasons,
      hasEvidenceConflict: input.hasEvidenceConflict,
      changeSummary: `反馈修订：${aggregate.event.content.slice(0, 300)}`,
      timestamp,
    })
    if (!accepted) throw new ApplicationError('VERSION_CONFLICT', '反馈状态或基础人物版本已经变化', 409)
  }

  /** @param feedbackId 反馈 UUID。 @returns 存在的反馈聚合。 */
  private async requireFeedback(feedbackId: string): Promise<FeedbackAggregate> {
    const value = await this.dependencies.repository.findFeedback(feedbackId)
    if (!value) throw new ApplicationError('RESOURCE_NOT_FOUND', '反馈不存在', 404)
    return value
  }

  /** @param proposalId 提案 UUID。 @returns 存在的修订提案。 */
  private async requireProposal(proposalId: string): Promise<RevisionProposalRecord> {
    const value = await this.dependencies.repository.findRevisionProposal(proposalId)
    if (!value) throw new ApplicationError('RESOURCE_NOT_FOUND', '修订提案不存在', 404)
    return value
  }

  /** @returns 已配置文本模型的非敏感快照。 */
  private requireModel() {
    const model = this.dependencies.model.getConfiguredModel()
    if (!model) throw new ApplicationError('CAPABILITY_DISABLED', '反馈分类与人物评测需要配置文本模型', 422)
    return model
  }

  /** @param proposal 已通过评测的原提案快照。 @returns 自动发布尝试结束时完成。 */
  private async tryAutomaticPublication(proposal: RevisionProposalRecord): Promise<void> {
    const activeVersionId = await this.dependencies.repository.findPersonaActiveVersionId(proposal.personaId)
    const decision = decideRevisionPublication({
      riskLevel: proposal.riskLevel,
      evaluationStatus: 'passed',
      baseVersionIsActive: activeVersionId === proposal.baseVersionId,
      hasEvidenceConflict: proposal.hasEvidenceConflict,
      autoPublishEnabled: this.dependencies.autoPublishLowRisk,
      manualConfirmation: false,
    })
    if (decision.action === 'auto_publish') {
      await this.dependencies.repository.publishProposal(proposal.id, decision.reason, this.dependencies.clock.now(), 'system')
    }
  }
}

/** @param aggregate 反馈领域聚合。 @returns 不暴露模型参数的公开视图。 */
function toFeedbackView(aggregate: FeedbackAggregate): FeedbackView {
  return {
    id: aggregate.event.id,
    runId: aggregate.event.runId,
    blockId: aggregate.event.blockId,
    content: aggregate.event.content,
    rating: aggregate.event.rating,
    isLongTerm: aggregate.event.isLongTerm,
    editedOutput: aggregate.event.editedOutput,
    suggestion: {
      targetType: aggregate.suggestion.targetType,
      confidence: aggregate.suggestion.confidence,
      rationale: aggregate.suggestion.rationale,
    },
    confirmedTarget: aggregate.resolution?.targetType ?? null,
    resolution: aggregate.resolution?.resolution ?? null,
    createdAt: aggregate.event.createdAt,
    confirmedAt: aggregate.resolution?.confirmedAt ?? null,
  }
}

/** @param proposal 提案领域记录。 @returns 公开提案视图。 */
function toProposalView(proposal: RevisionProposalRecord): RevisionProposalView {
  return { ...proposal }
}

/** @param result 逐用例领域结果。 @returns 不包含数据库外键的公开结果。 */
function toEvaluationResultView(result: EvaluationResultRecord): EvaluationResultView {
  return {
    id: result.id,
    caseId: result.caseId,
    caseName: result.caseName,
    status: result.status,
    baseScore: result.baseScore,
    candidateScore: result.candidateScore,
    baseOutput: result.baseOutput,
    candidateOutput: result.candidateOutput,
    failures: result.failures,
    reasoningSummary: result.reasoningSummary,
  }
}

/**
 * 对模型输出执行可重复的词项、最低分和版本退化检查。
 * @param evaluationCase 固定用例和断言。
 * @param output 模型返回的基础与候选证据。
 * @returns 空数组表示通过，否则为全部硬失败原因。
 */
function evaluateCaseRules(
  evaluationCase: EvaluationCaseRecord,
  output: { baseOutput: string, candidateOutput: string, baseScore: number, candidateScore: number },
): string[] {
  const failures: string[] = []
  const candidateText = output.candidateOutput.toLocaleLowerCase('zh-CN')
  for (const term of evaluationCase.requiredTerms) {
    if (!candidateText.includes(term.toLocaleLowerCase('zh-CN'))) failures.push(`候选输出缺少必需词：${term}`)
  }
  for (const term of evaluationCase.forbiddenTerms) {
    if (candidateText.includes(term.toLocaleLowerCase('zh-CN'))) failures.push(`候选输出包含禁用词：${term}`)
  }
  if (output.candidateScore < evaluationCase.minimumScore) {
    failures.push(`候选评分 ${output.candidateScore} 低于最低值 ${evaluationCase.minimumScore}`)
  }
  if (evaluationCase.expectedChange === 'improve' && output.candidateScore <= output.baseScore) {
    failures.push('目标改善用例的候选评分没有高于基础版本')
  }
  if (evaluationCase.expectedChange === 'retain' && output.candidateScore < output.baseScore - evaluationCase.maxRegression) {
    failures.push(`保留用例退化超过允许值 ${evaluationCase.maxRegression}`)
  }
  return failures
}

/** @param error 未知模型错误。 @returns 稳定且不泄露供应商响应的应用错误。 */
function toModelApplicationError(error: unknown): ApplicationError {
  if (error instanceof TextModelError) {
    const status = error.code === 'CAPABILITY_DISABLED' ? 422 : error.code === 'MODEL_OUTPUT_INVALID' ? 502 : 503
    return new ApplicationError(error.code, error.message, status)
  }
  if (error instanceof ZodError) return new ApplicationError('MODEL_OUTPUT_INVALID', '模型结构化输出未通过校验', 502)
  return new ApplicationError('PROVIDER_UNAVAILABLE', '文本模型调用失败', 503)
}

/** @param error 未知数据库错误。 @returns 是否为 SQLite 唯一约束冲突。 */
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}

/** @param result 仓储原子发布结果。 @returns 对应稳定应用错误。 */
function publicationResultError(result: 'not_ready' | 'base_version_changed' | 'already_decided'): ApplicationError {
  if (result === 'base_version_changed') {
    return new ApplicationError('VERSION_CONFLICT', '人物当前版本已经变化，请重新建立提案', 409)
  }
  if (result === 'not_ready') return new ApplicationError('REVISION_PUBLICATION_BLOCKED', '提案尚未通过评测', 409)
  return new ApplicationError('VERSION_CONFLICT', '提案已经发布或拒绝', 409)
}

/** @param payloadJson 任务载荷 JSON。 @returns 评测运行 UUID。 */
function readEvaluationRunId(payloadJson: string): string {
  const value = JSON.parse(payloadJson) as Record<string, unknown>
  if (typeof value.evaluationRunId !== 'string') throw new Error('评测任务载荷缺少评测运行标识')
  return value.evaluationRunId
}

/** @param error 未知评测执行错误。 @returns Worker 使用的稳定错误和重试语义。 */
function normalizeEvaluationError(error: unknown): { code: string, message: string, retryable: boolean } {
  if (error instanceof TextModelError) return { code: error.code, message: error.message, retryable: error.retryable }
  if (error instanceof ZodError) return { code: 'MODEL_OUTPUT_INVALID', message: '评测模型结构化输出未通过校验', retryable: true }
  if (error instanceof ApplicationError) return { code: error.code, message: error.message, retryable: false }
  return {
    code: 'EVALUATION_EXECUTION_FAILED',
    message: error instanceof Error ? error.message.slice(0, 500) : '人物评测执行失败',
    retryable: true,
  }
}
