import type { FeedbackTarget } from '../../../shared/schemas/feedback'
import type { PersonaSnapshot } from '../../../shared/types/content'
import type { TextModelParameters } from '../../../shared/schemas/generation'
import type { TextModelSnapshot } from '../generation/GenerationModels'
import type { RevisionRiskLevel } from './RevisionPolicy'

/** 只追加保存的用户原始反馈事件。 */
export interface FeedbackEventRecord {
  id: string
  runId: string
  blockId: string | null
  content: string
  rating: 'positive' | 'negative' | 'neutral' | null
  isLongTerm: boolean
  editedOutput: string | null
  createdAt: number
}

/** AI 对反馈目标给出的可纠正建议。 */
export interface FeedbackSuggestionRecord {
  feedbackId: string
  targetType: FeedbackTarget
  confidence: number
  rationale: string
  modelSnapshot: TextModelSnapshot
  parameterSnapshot: TextModelParameters
  promptVersion: string
  createdAt: number
}

/** 用户确认分类后保存的唯一业务动作结果。 */
export interface FeedbackResolutionRecord {
  feedbackId: string
  targetType: FeedbackTarget
  resolution: Record<string, unknown>
  confirmedAt: number
}

/** 候选记忆在进入提案前后的状态。 */
export interface CandidateMemoryRecord {
  id: string
  feedbackId: string
  personaId: string
  content: string
  status: 'proposed' | 'promoted' | 'rejected'
  proposalId: string | null
  createdAt: number
}

/** 修订提案保存的完整字段差异。 */
export interface RevisionPatchRecord {
  field: keyof PersonaSnapshot
  before: string
  after: string
  reason: string
}

/** 人物修订提案事实记录。 */
export interface RevisionProposalRecord {
  id: string
  feedbackId: string
  personaId: string
  baseVersionId: string
  candidateVersionId: string
  riskLevel: RevisionRiskLevel
  status: 'awaiting_evaluation' | 'evaluation_failed' | 'ready' | 'published' | 'rejected'
  patches: RevisionPatchRecord[]
  riskReasons: string[]
  hasEvidenceConflict: boolean
  latestEvaluationRunId: string | null
  decisionReason: string | null
  createdAt: number
  updatedAt: number
}

/** 一条固定人物回归评测用例。 */
export interface EvaluationCaseRecord {
  id: string
  personaId: string
  name: string
  category: 'behavior' | 'style' | 'safety'
  prompt: string
  expectedChange: 'improve' | 'retain'
  requiredTerms: string[]
  forbiddenTerms: string[]
  minimumScore: number
  maxRegression: number
  isActive: boolean
  createdAt: number
}

/** 一次评测运行的固定输入与汇总。 */
export interface EvaluationRunRecord {
  id: string
  proposalId: string
  candidateVersionId: string
  status: 'queued' | 'running' | 'passed' | 'failed'
  modelSnapshot: TextModelSnapshot
  parameterSnapshot: TextModelParameters
  promptVersion: string
  passedCases: number
  totalCases: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: number
  completedAt: number | null
}

/** 评测模型证据与硬规则合并后的逐用例结果。 */
export interface EvaluationResultRecord {
  id: string
  evaluationRunId: string
  caseId: string
  caseName: string
  status: 'passed' | 'failed'
  baseScore: number
  candidateScore: number
  baseOutput: string
  candidateOutput: string
  failures: string[]
  reasoningSummary: string
}
