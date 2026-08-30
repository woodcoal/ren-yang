import type { FeedbackTarget } from '../schemas/feedback'

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
  /** 用户是否明确表达长期学习意图。 */
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
  /** 目标动作的业务结果；人物学习目标包含新反馈资料标识。 */
  resolution: Record<string, unknown> | null
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
  /** 用户确认时间，尚未确认时为 null。 */
  confirmedAt: number | null
}
