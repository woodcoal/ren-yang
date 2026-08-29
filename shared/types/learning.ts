/** 成长与记忆统一生命周期状态。 */
export type LearningStatus = 'candidate' | 'active' | 'superseded' | 'archived' | 'rejected'

/** 世界成长分析可使用的资料关联。 */
export interface WorldGrowthSourceView {
  /** 资料 UUID。 */
  id: string
  /** 资料名称。 */
  name: string
  /** 资料正文摘要。 */
  summary: string
  /** 分析时使用的完整资料正文。 */
  content: string
  /** 完整正文 SHA-256。 */
  contentHash: string
  /** 是否参加后续世界成长分析。 */
  isEnabled: boolean
  /** 关联更新时间。 */
  updatedAt: number
}

/** 人物明确提供的成长反馈资料。 */
export interface PersonaFeedbackSourceView {
  /** 反馈资料 UUID。 */
  id: string
  /** 所属人物 UUID。 */
  personaId: string
  /** 展示标题。 */
  title: string
  /** 完整反馈正文。 */
  content: string
  /** 反馈资料来源类型。 */
  sourceType: 'run_feedback' | 'manual' | 'imported' | 'memory_conversion'
  /** 原始业务记录 UUID。 */
  sourceId: string | null
  /** 是否参加后续人物成长分析。 */
  isEnabled: boolean
  /** 正文 SHA-256。 */
  contentHash: string
  /** 删除同步状态。 */
  deletionState: 'active' | 'pending_remote_delete'
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** 成长当前修订及其来源证据。 */
export interface GrowthRecordView {
  /** 稳定成长 UUID。 */
  id: string
  /** 所属对象类型。 */
  subjectType: 'world' | 'persona'
  /** 所属对象 UUID。 */
  subjectId: string
  /** 当前生命周期状态。 */
  status: LearningStatus
  /** 当前修订 UUID。 */
  revisionId: string
  /** 当前修订号。 */
  revisionNo: number
  /** 成长正文。 */
  content: string
  /** 适用范围。 */
  scope: string
  /** 重要程度，1 到 5。 */
  importance: number
  /** 已发现的冲突说明。 */
  conflictSummary: string | null
  /** 当前修订的证据数量。 */
  evidenceCount: number
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** 人物一次任务形成的记忆分析原始记录。 */
export interface PersonaOperationRecordView {
  /** 处理记录 UUID。 */
  id: string
  /** 所属人物 UUID。 */
  personaId: string
  /** 对应运行 UUID。 */
  runId: string
  /** 处理类型。 */
  operationType: 'interest_assessment' | 'artifact_generation' | 'content_analysis'
  /** 便于列表阅读的结果摘要。 */
  resultSummary: string
  /** 是否参加后续记忆分析。 */
  isEnabled: boolean
  /** OpenViking Session 同步记录 UUID。 */
  sessionRecordId: string | null
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** 人物当前记忆修订。 */
export interface MemoryRecordView {
  /** 稳定记忆 UUID。 */
  id: string
  /** 所属人物 UUID。 */
  personaId: string
  /** 记忆类型。 */
  memoryType: 'interest' | 'judgment' | 'experience' | 'preference'
  /** 当前生命周期状态。 */
  status: LearningStatus
  /** 当前修订 UUID。 */
  revisionId: string
  /** 当前修订号。 */
  revisionNo: number
  /** 记忆正文。 */
  content: string
  /** 适用范围。 */
  scope: string
  /** 重要程度，1 到 5。 */
  importance: number
  /** 独立任务证据数量。 */
  independentEvidenceCount: number
  /** 已发现的冲突说明。 */
  conflictSummary: string | null
  /** OpenViking 派生内容精确 URI。 */
  openVikingUri: string | null
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** 世界成长标签页完整视图。 */
export interface WorldGrowthWorkspaceView {
  /** 参加成长分析的世界资料。 */
  sources: WorldGrowthSourceView[]
  /** 世界成长结论。 */
  growth: GrowthRecordView[]
}

/** 人物成长标签页完整视图。 */
export interface PersonaGrowthWorkspaceView {
  /** 人物反馈原始资料。 */
  feedbackSources: PersonaFeedbackSourceView[]
  /** 人物成长结论。 */
  growth: GrowthRecordView[]
}

/** 人物记忆标签页完整视图。 */
export interface PersonaMemoryWorkspaceView {
  /** 人物任务处理记录。 */
  operationRecords: PersonaOperationRecordView[]
  /** 人物记忆结论。 */
  memories: MemoryRecordView[]
}
