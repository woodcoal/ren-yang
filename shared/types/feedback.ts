import type { FeedbackTarget } from '../schemas/feedback'
import type { PersonaSnapshot } from './content'

/** 原始反馈、模型建议和用户确认的统一公开视图。 */
export interface FeedbackView {
  /** 反馈事件 UUID。 */
  id: string
  /** 所属生成运行 UUID。 */
  runId: string
  /** 可选目标产物块 UUID。 */
  blockId: string | null
  /** 用户原始反馈正文。 */
  content: string
  /** 可选的显式评价方向。 */
  rating: 'positive' | 'negative' | 'neutral' | null
  /** 用户是否明确要求形成长期变化。 */
  isLongTerm: boolean
  /** 用户直接编辑后的输出。 */
  editedOutput: string | null
  /** AI 分类建议。 */
  suggestion: {
    targetType: FeedbackTarget
    confidence: number
    rationale: string
  }
  /** 用户确认后的目标，尚未确认时为 null。 */
  confirmedTarget: FeedbackTarget | null
  /** 目标动作的业务结果；不包含模型私有响应。 */
  resolution: Record<string, unknown> | null
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
  /** 用户确认时间，尚未确认时为 null。 */
  confirmedAt: number | null
}

/** 修订提案保存的完整字段差异。 */
export interface RevisionPatchView {
  /** 人物快照字段。 */
  field: keyof PersonaSnapshot
  /** 基础版本字段值。 */
  before: string
  /** 候选版本字段值。 */
  after: string
  /** 支持变化的原因。 */
  reason: string
}

/** 候选记忆公开视图。 */
export interface CandidateMemoryView {
  /** 候选记忆 UUID。 */
  id: string
  /** 所属人物 UUID。 */
  personaId: string
  /** 从反馈中提取且仍需提案门禁的长期假设。 */
  content: string
  /** 候选记忆状态。 */
  status: 'proposed' | 'promoted' | 'rejected'
  /** 已转化的修订提案 UUID。 */
  proposalId: string | null
  /** 创建时间。 */
  createdAt: number
}

/** 管理界面可审核的人物记忆。 */
export interface PersonaMemoryView {
  /** 本地记忆标识。 */
  id: string
  /** 所属人物 UUID。 */
  personaId: string
  /** 完整记忆正文。 */
  content: string
  /** OpenViking 或本地业务类型。 */
  memoryType: string
  /** 只有 active 会参与后续检索。 */
  status: 'candidate' | 'active' | 'deprecated' | 'rejected'
  /** 记忆来源。 */
  sourceType: 'openviking_session' | 'feedback' | 'manual'
  /** 本地来源 UUID。 */
  sourceId: string | null
  /** OpenViking 派生记忆精确 URI。 */
  remoteUri: string | null
  /** 创建时间。 */
  createdAt: number
  /** 最近更新时间。 */
  updatedAt: number
}

/** 人物修订提案及发布门禁状态。 */
export interface RevisionProposalView {
  /** 提案 UUID。 */
  id: string
  /** 来源反馈 UUID。 */
  feedbackId: string
  /** 目标人物 UUID。 */
  personaId: string
  /** 不可变基础版本 UUID。 */
  baseVersionId: string
  /** 已创建的不可变候选版本 UUID。 */
  candidateVersionId: string
  /** 确定性字段风险。 */
  riskLevel: 'low' | 'high' | 'critical'
  /** 当前提案状态。 */
  status: 'awaiting_evaluation' | 'evaluation_failed' | 'ready' | 'published' | 'rejected'
  /** 完整字段差异。 */
  patches: RevisionPatchView[]
  /** 风险判定原因。 */
  riskReasons: string[]
  /** 是否存在未解决证据冲突。 */
  hasEvidenceConflict: boolean
  /** 最近一次评测 UUID。 */
  latestEvaluationRunId: string | null
  /** 发布或拒绝的审计原因。 */
  decisionReason: string | null
  /** 创建时间。 */
  createdAt: number
  /** 最近状态变化时间。 */
  updatedAt: number
}

/** 固定人物回归用例。 */
export interface EvaluationCaseView {
  /** 用例 UUID。 */
  id: string
  /** 所属人物 UUID。 */
  personaId: string
  /** 人物内唯一名称。 */
  name: string
  /** 评测类别。 */
  category: 'behavior' | 'style' | 'safety'
  /** 固定场景或任务输入。 */
  prompt: string
  /** 目标用例需改善，保留用例不得明显退化。 */
  expectedChange: 'improve' | 'retain'
  /** 候选输出必须包含的词。 */
  requiredTerms: string[]
  /** 候选输出不得包含的词。 */
  forbiddenTerms: string[]
  /** 模型辅助评分最低值。 */
  minimumScore: number
  /** 保留用例允许的最大分数回退。 */
  maxRegression: number
  /** 是否参与后续评测。 */
  isActive: boolean
  /** 创建时间。 */
  createdAt: number
}

/** 单个用例的模型证据与确定性判定。 */
export interface EvaluationResultView {
  /** 结果 UUID。 */
  id: string
  /** 固定用例 UUID。 */
  caseId: string
  /** 用例名称快照。 */
  caseName: string
  /** 最终确定性状态。 */
  status: 'passed' | 'failed'
  /** 基础版本模型辅助分数。 */
  baseScore: number
  /** 候选版本模型辅助分数。 */
  candidateScore: number
  /** 基础版本模拟输出。 */
  baseOutput: string
  /** 候选版本模拟输出。 */
  candidateOutput: string
  /** 命中的硬规则失败原因。 */
  failures: string[]
  /** 面向用户的模型简短说明。 */
  reasoningSummary: string
}

/** 一次完整评测的不可变输入和结果快照。 */
export interface EvaluationRunView {
  /** 评测运行 UUID。 */
  id: string
  /** 所属提案 UUID。 */
  proposalId: string
  /** 被评测候选版本 UUID。 */
  candidateVersionId: string
  /** 评测最终状态。 */
  status: 'queued' | 'running' | 'passed' | 'failed'
  /** 固定评测模型的非敏感快照。 */
  model: { provider: 'openai_compatible', model: string, endpointOrigin: string }
  /** 固定提示版本。 */
  promptVersion: string
  /** 逐用例结果。 */
  results: EvaluationResultView[]
  /** 通过用例数。 */
  passedCases: number
  /** 总用例数。 */
  totalCases: number
  /** 创建时间。 */
  createdAt: number
  /** 完成时间。 */
  completedAt: number | null
}

/** 创建异步评测后的稳定标识。 */
export interface CreatedEvaluationRun {
  /** 评测运行 UUID。 */
  evaluationRunId: string
  /** 持久任务 UUID。 */
  taskId: string
  /** 初始状态固定为排队中。 */
  status: 'queued'
}
