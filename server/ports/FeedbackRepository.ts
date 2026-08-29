import type { PersonaSnapshot } from '../../shared/types/content'
import type {
  CandidateMemoryRecord,
  EvaluationCaseRecord,
  EvaluationResultRecord,
  EvaluationRunRecord,
  FeedbackEventRecord,
  FeedbackResolutionRecord,
  FeedbackSuggestionRecord,
  RevisionPatchRecord,
  RevisionProposalRecord,
} from '../domain/feedback/FeedbackModels'
import type { RevisionRiskLevel } from '../domain/feedback/RevisionPolicy'

/** 反馈列表使用的完整聚合读取结果。 */
export interface FeedbackAggregate {
  event: FeedbackEventRecord
  suggestion: FeedbackSuggestionRecord
  resolution: FeedbackResolutionRecord | null
}

/** 长期人物反馈原子创建提案需要的全部事实。 */
export interface CreateRevisionProposalCommand {
  feedbackId: string
  resolutionTarget: 'persona'
  resolution: Record<string, unknown>
  memoryId: string
  proposalId: string
  personaId: string
  baseVersionId: string
  candidateVersionId: string
  candidateSnapshot: PersonaSnapshot
  patches: RevisionPatchRecord[]
  riskLevel: RevisionRiskLevel
  riskReasons: string[]
  hasEvidenceConflict: boolean
  changeSummary: string
  timestamp: number
}

/** 创建评测运行的完整输入快照。 */
export type CreateEvaluationRunCommand = EvaluationRunRecord

/** 发布提案的原子结果。 */
export type PublishProposalResult = 'published' | 'not_ready' | 'base_version_changed' | 'already_decided'

/** 反馈、修订、评测与人物版本事务的事实源端口。 */
export interface FeedbackRepository {
  /** @param event 原始反馈。 @param suggestion AI 分类建议。 @returns 运行和块关系有效时为 true。 */
  createFeedback(event: FeedbackEventRecord, suggestion: FeedbackSuggestionRecord): Promise<boolean>
  /** @returns 新反馈在前的完整反馈聚合。 */
  listFeedback(): Promise<FeedbackAggregate[]>
  /** @param feedbackId 反馈 UUID。 @returns 反馈聚合或 null。 */
  findFeedback(feedbackId: string): Promise<FeedbackAggregate | null>
  /** @param runId 运行 UUID。 @returns 运行绑定的人物和版本，找不到时为 null。 */
  findRunPersonaVersion(runId: string): Promise<{ personaId: string, personaVersionId: string, snapshot: PersonaSnapshot, activeVersionId: string | null } | null>
  /** @param versionId 人物版本 UUID。 @returns 版本快照及人物或 null。 */
  findPersonaVersionSnapshot(versionId: string): Promise<{ personaId: string, snapshot: PersonaSnapshot } | null>
  /** @param personaId 人物 UUID。 @returns 当前活动版本 UUID 或 null。 */
  findPersonaActiveVersionId(personaId: string): Promise<string | null>
  /** @param feedbackId 反馈 UUID。 @param blockId 块 UUID。 @param taskId 新任务 UUID。 @param timestamp 确认时间。 @returns 原子确认和入队是否成功。 */
  confirmArtifactFeedback(feedbackId: string, blockId: string, taskId: string, timestamp: number): Promise<boolean>
  /** @param feedbackId 反馈 UUID。 @param targetType 参数或资料目标。 @param resolution 业务结果。 @param timestamp 确认时间。 @returns 是否首次确认。 */
  confirmSimpleFeedback(feedbackId: string, targetType: 'parameters' | 'source_fact', resolution: Record<string, unknown>, timestamp: number): Promise<boolean>
  /** @param command 人物候选版本、记忆、提案和确认结果。 @returns 是否原子创建。 */
  createRevisionProposal(command: CreateRevisionProposalCommand): Promise<boolean>
  /** @param filter 可选人物和状态。 @returns 新提案在前的列表。 */
  listRevisionProposals(filter: { personaId?: string, status?: RevisionProposalRecord['status'] }): Promise<RevisionProposalRecord[]>
  /** @param proposalId 提案 UUID。 @returns 提案或 null。 */
  findRevisionProposal(proposalId: string): Promise<RevisionProposalRecord | null>
  /** @param personaId 人物 UUID。 @returns 活动用例在前、停用用例在后的列表。 */
  listEvaluationCases(personaId: string): Promise<EvaluationCaseRecord[]>
  /** @param evaluationCase 新评测用例。 @returns 无返回值。 */
  createEvaluationCase(evaluationCase: EvaluationCaseRecord): Promise<void>
  /** @param run 固定评测运行输入。 @param taskId 持久任务 UUID。 @returns 是否原子建立排队评测和任务。 */
  createEvaluationRun(run: CreateEvaluationRunCommand, taskId: string): Promise<boolean>
  /** @param runId 评测运行 UUID。 @returns 是否从排队状态进入运行状态。 */
  startEvaluationRun(runId: string): Promise<boolean>
  /** @param runId 评测运行 UUID。 @returns 为自动重试恢复排队状态。 */
  prepareEvaluationRetry(runId: string): Promise<void>
  /** @param runId 运行 UUID。 @param results 逐用例结果。 @param status 汇总结论。 @param timestamp 完成时间。 @returns 无返回值。 */
  completeEvaluationRun(runId: string, results: EvaluationResultRecord[], status: 'passed' | 'failed', timestamp: number): Promise<void>
  /** @param runId 运行 UUID。 @param code 稳定错误码。 @param message 脱敏原因。 @param timestamp 完成时间。 @returns 无返回值。 */
  failEvaluationRun(runId: string, code: string, message: string, timestamp: number): Promise<void>
  /** @param runId 评测运行 UUID。 @returns 运行与逐用例结果或 null。 */
  findEvaluationRun(runId: string): Promise<{ run: EvaluationRunRecord, results: EvaluationResultRecord[] } | null>
  /** @param proposalId 提案 UUID。 @param reason 发布原因。 @param timestamp 发布时间。 @returns 原子发布结果。 */
  publishProposal(proposalId: string, reason: string, timestamp: number): Promise<PublishProposalResult>
  /** @param proposalId 提案 UUID。 @param reason 拒绝原因。 @param timestamp 拒绝时间。 @returns 是否拒绝。 */
  rejectProposal(proposalId: string, reason: string, timestamp: number): Promise<boolean>
  /** @param personaId 人物 UUID。 @returns 人物是否存在。 */
  personaExists(personaId: string): Promise<boolean>
  /** @param sourceId 资料 UUID。 @returns 资料是否存在。 */
  sourceExists(sourceId: string): Promise<boolean>
  /** @param feedbackId 反馈 UUID。 @returns 关联的候选记忆或 null。 */
  findCandidateMemory(feedbackId: string): Promise<CandidateMemoryRecord | null>
}
