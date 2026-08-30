/** 成长与记忆统一生命周期状态。 */
export type LearningStatus = 'candidate' | 'active' | 'superseded' | 'archived' | 'rejected'

/** 成长与记忆完整提示词的业务类型。 */
export type LearningPromptType = 'world_growth' | 'persona_growth' | 'persona_memory'

/** 当前对象资料库中可选为成长素材的资料。 */
export interface GrowthLibrarySourceView {
  /** 资料 UUID。 */
  id: string
  /** 资料名称。 */
  name: string
  /** 资料正文摘要。 */
  summary: string
  /** 导入时复制的完整正文。 */
  content: string
  /** 当前完整正文 SHA-256。 */
  contentHash: string
  /** 资料是否允许用于任务检索。 */
  isEnabled: boolean
  /** 是否已经进入当前对象的成长素材池。 */
  isImported: boolean
}

/** 一份用于 AI 提炼完整成长提示词的原始素材。 */
export interface GrowthMaterialView {
  /** 成长素材 UUID。 */
  id: string
  /** 所属对象类型。 */
  subjectType: 'world' | 'persona'
  /** 所属对象 UUID。 */
  subjectId: string
  /** 展示标题。 */
  title: string
  /** 分析使用的固定正文快照。 */
  content: string
  /** 固定正文 SHA-256。 */
  contentHash: string
  /** 素材来源类型。 */
  sourceType: 'source_material' | 'manual' | 'legacy'
  /** 来源资料 UUID；手工和旧数据素材为空。 */
  sourceId: string | null
  /** 来源资料同步状态。 */
  sourceState: 'current' | 'changed' | 'missing' | 'not_applicable'
  /** AI 提炼时的人工权重，1 到 5。 */
  importance: number
  /** 是否参加下一次成长提炼。 */
  isEnabled: boolean
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** 尚未发布、不会进入任务的学习提示词草稿。 */
export interface LearningPromptDraftView {
  /** 草稿 UUID。 */
  id: string
  /** 草稿基于的已发布版本 UUID。 */
  baseVersionId: string | null
  /** 完整提示词正文。 */
  promptText: string
  /** 来源分析批次 UUID；纯手工草稿为空。 */
  sourceAnalysisBatchId: string | null
  /** 草稿来源。 */
  createdBy: 'analysis' | 'user' | 'migration'
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** 已发布且不可变的完整学习提示词版本。 */
export interface LearningPromptVersionView {
  /** 版本 UUID。 */
  id: string
  /** 当前提示词内部版本号。 */
  versionNo: number
  /** 上一版本 UUID。 */
  parentVersionId: string | null
  /** 完整提示词正文。 */
  promptText: string
  /** 来源分析批次 UUID；纯手工版本为空。 */
  sourceAnalysisBatchId: string | null
  /** 版本变更说明。 */
  changeSummary: string
  /** 版本来源。 */
  createdBy: 'analysis' | 'user' | 'migration'
  /** 发布时间。 */
  publishedAt: number
}

/** 一个成长或记忆提示词的草稿、当前版本和历史工作区。 */
export interface LearningPromptWorkspaceView {
  /** 提示词类型。 */
  promptType: LearningPromptType
  /** 已发布且进入新任务的当前版本。 */
  activeVersion: LearningPromptVersionView | null
  /** 尚未发布的唯一草稿。 */
  draft: LearningPromptDraftView | null
  /** 从新到旧的发布历史。 */
  versions: LearningPromptVersionView[]
}

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
  /** 便于识别任务的标题。 */
  title: string
  /** 供记忆提炼使用的任务输入与结果快照。 */
  content: string
  /** 任务素材正文 SHA-256。 */
  contentHash: string
  /** 便于列表阅读的结果摘要。 */
  resultSummary: string
  /** 是否参加后续记忆分析。 */
  isEnabled: boolean
  /** AI 提炼记忆提示词时的人工权重，1 到 5。 */
  importance: number
  /** OpenViking Session 同步记录 UUID。 */
  sessionRecordId: string | null
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
}

/** OpenViking 从人物 Session 派生、只供记忆分析使用的原始素材。 */
export interface OpenVikingDerivedMemoryView {
  /** SQLite 素材 UUID。 */
  id: string
  /** OpenViking 记忆类别。 */
  memoryType: string
  /** 完整正文。 */
  content: string
  /** 正文 SHA-256。 */
  contentHash: string
  /** 最近同步时间。 */
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
  /** 当前世界资料库中可选的资料。 */
  sources: GrowthLibrarySourceView[]
  /** 已选择或手工添加的成长素材。 */
  materials: GrowthMaterialView[]
  /** 世界唯一成长提示词工作区。 */
  prompt: LearningPromptWorkspaceView
}

/** 人物成长标签页完整视图。 */
export interface PersonaGrowthWorkspaceView {
  /** 当前人物资料库中可选的资料。 */
  sources: GrowthLibrarySourceView[]
  /** 已选择或手工添加的成长素材。 */
  materials: GrowthMaterialView[]
  /** 人物唯一成长提示词工作区。 */
  prompt: LearningPromptWorkspaceView
}

/** 人物记忆标签页完整视图。 */
export interface PersonaMemoryWorkspaceView {
  /** 人物历史任务形成的记忆素材。 */
  operationRecords: PersonaOperationRecordView[]
  /** 人物唯一记忆提示词工作区。 */
  prompt: LearningPromptWorkspaceView
}
