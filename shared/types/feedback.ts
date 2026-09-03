import type { FeedbackTarget } from '../schemas/feedback'
/** 已确认反馈所触发的当前产物修正任务。 */
export interface FeedbackArtifactImpact {
  /** 固定目标类型。 */
  targetType: 'artifact'
  /** 被修正的产物块 UUID。 */
  blockId: string
  /** 反馈创建的修正任务 UUID。 */
  taskId: string
  /** 目标块当前状态。 */
  blockStatus: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | null
  /** 修正任务当前状态；任务清理后为空。 */
  task: { status: string, attemptCount: number, maxAttempts: number, lastError: string | null } | null
}

/** 已确认反馈所记录、但尚未自动应用的运行参数建议。 */
export interface FeedbackParameterImpact {
  /** 固定目标类型。 */
  targetType: 'parameters'
  /** 用户确认保存的建议正文。 */
  recommendation: string
  /** 建议适用范围。 */
  scope: string
  /** 参数建议不会由系统自动应用。 */
  isApplied: false
}

/** 已确认反馈所记录的资料事实问题。 */
export interface FeedbackSourceFactImpact {
  /** 固定目标类型。 */
  targetType: 'source_fact'
  /** 被指出问题的资料 UUID。 */
  sourceId: string
  /** 资料仍存在时的名称；被删除时为空。 */
  sourceName: string | null
  /** 用户是否确认存在事实冲突。 */
  hasEvidenceConflict: boolean
  /** 资料问题不会由系统自动改写资料或人物。 */
  automaticMindChange: false
}

/** 已确认人物学习反馈的成长分析与发布影响。 */
export interface FeedbackPersonaImpact {
  /** 固定目标类型。 */
  targetType: 'persona'
  /** 反馈所属人物 UUID。 */
  personaId: string
  /** 原始人物反馈资料 UUID。 */
  feedbackSourceId: string
  /** 可供成长提炼的成长素材 UUID。 */
  growthMaterialId: string
  /** 成长素材仍存在时的当前参与状态。 */
  material: { importance: number, isEnabled: boolean } | null
  /** 最近一次实际使用该素材的成长分析；尚未提炼时为空。 */
  analysis: { id: string, status: 'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed', resultSummary: string | null, errorMessage: string | null, completedAt: number | null } | null
  /** 实际由该分析发布的成长提示词版本；尚未发布时为空。 */
  publishedPrompt: { id: string, versionNo: number, publishedAt: number } | null
  /** 已固定使用该提示词版本的后续运行。 */
  affectedRuns: Array<{ id: string, personaName: string, status: string, createdAt: number }>
}

/** 已确认反馈的可审计实际影响。 */
export type FeedbackResolutionImpact = FeedbackArtifactImpact | FeedbackParameterImpact | FeedbackSourceFactImpact | FeedbackPersonaImpact


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
  /** 目标动作的原始持久化结果。 */
  resolution: Record<string, unknown> | null
  /** 已确认动作、成长提炼、提示词发布和后续运行的可审计影响。 */
  impact: FeedbackResolutionImpact | null
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
  /** 用户确认时间，尚未确认时为 null。 */
  confirmedAt: number | null
}
