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

/** 反馈确认后各目标动作的持久化审计关系。 */
export interface FeedbackResolutionImpactRecord {
  /** 反馈确认的最终目标。 */
  targetType: FeedbackTarget
  /** 原始动作结果。 */
  resolution: Record<string, unknown>
  /** 当前产物修正块与任务状态。 */
  artifact: { blockStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | null, task: { status: string, attemptCount: number, maxAttempts: number, lastError: string | null } | null } | null
  /** 资料事实问题关联资料的名称。 */
  sourceName: string | null
  /** 人物成长素材、分析、发布版本及受影响运行。 */
  persona: {
    material: { importance: number, isEnabled: boolean } | null
    analysis: { id: string, status: 'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed', resultSummary: string | null, errorMessage: string | null, completedAt: number | null } | null
    publishedPrompt: { id: string, versionNo: number, publishedAt: number } | null
    affectedRuns: Array<{ id: string, personaName: string, status: string, createdAt: number }>
  } | null
}
