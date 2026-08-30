import type { FeedbackTarget } from '../../../shared/schemas/feedback'
import type { TextModelParameters } from '../../../shared/schemas/generation'
import type { TextModelSnapshot } from '../generation/GenerationModels'

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
