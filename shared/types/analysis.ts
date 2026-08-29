import type { LearningStatus } from './learning'

/** AI 迭代分析类型。 */
export type AnalysisType = 'world_growth' | 'persona_growth' | 'persona_memory'

/** 分析批次实际使用的原始输入快照。 */
export interface AnalysisBatchInputView {
  /** 批次输入 UUID，供模型和证据链引用。 */
  id: string
  /** 原始数据类型。 */
  inputType: 'world_source' | 'persona_feedback_source' | 'persona_operation_record' | 'openviking_memory'
  /** SQLite 原始数据 UUID。 */
  inputId: string
  /** 输入标题或摘要。 */
  title: string
  /** 分析时固定的正文。 */
  contentSnapshot: string | null
  /** 正文哈希。 */
  contentHash: string
  /** 是否属于本次增量的新输入。 */
  isNew: boolean
  /** 原始正文当前是否仍可用。 */
  sourceAvailable: boolean
}

/** 提案中可由管理员调整的长期内容。 */
export interface ProposedLearningContentView {
  /** 长期内容正文。 */
  content: string
  /** 适用范围。 */
  scope: string
  /** 重要程度。 */
  importance: number
  /** 记忆类型；成长提案为空。 */
  memoryType?: 'interest' | 'judgment' | 'experience' | 'preference'
}

/** 一项等待人工审核的 AI 迭代提案。 */
export interface IterationProposalView {
  /** 提案 UUID。 */
  id: string
  /** 建议操作。 */
  operation: 'add' | 'revise' | 'merge' | 'supersede' | 'archive' | 'no_change'
  /** 成长或记忆。 */
  targetType: 'growth' | 'memory'
  /** 被修改、合并、取代或停用的记录 UUID。 */
  targetIds: string[]
  /** 建议生成时的旧内容快照。 */
  before: Array<{ id: string, status: LearningStatus, content: string }>
  /** AI 建议内容。 */
  proposed: ProposedLearningContentView | null
  /** 管理员确认时的最终内容。 */
  reviewed: ProposedLearningContentView | null
  /** 引用的批次输入 UUID。 */
  evidenceInputIds: string[]
  /** 模型发现但未自动解决的冲突。 */
  conflicts: string[]
  /** AI 给出的简短依据。 */
  rationale: string
  /** 审核和应用状态。 */
  status: 'pending' | 'accepted' | 'rejected' | 'applied'
  /** 人工审核说明。 */
  reviewReason: string | null
  /** 审核时间。 */
  reviewedAt: number | null
  /** 创建时间。 */
  createdAt: number
}

/** 可供后台查看和审核的完整分析批次。 */
export interface AnalysisBatchView {
  /** 批次 UUID。 */
  id: string
  /** 分析类型。 */
  analysisType: AnalysisType
  /** 所属对象 UUID。 */
  subjectId: string
  /** 增量或完整重建。 */
  mode: 'incremental' | 'full_rebuild'
  /** 当前执行状态。 */
  status: 'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed'
  /** 分析基线灵魂版本 UUID。 */
  baselineSoulVersionId: string
  /** 分析实际输入。 */
  inputs: AnalysisBatchInputView[]
  /** AI 迭代提案。 */
  proposals: IterationProposalView[]
  /** 失败稳定代码。 */
  errorCode: string | null
  /** 脱敏错误。 */
  errorMessage: string | null
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
  /** 完成时间。 */
  completedAt: number | null
}
