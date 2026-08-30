import type {
  GrowthRecordView,
  GrowthMaterialView,
  LearningPromptType,
  LearningPromptVersionView,
  LearningPromptWorkspaceView,
  MemoryRecordView,
  OpenVikingDerivedMemoryView,
  PersonaExternalRecordView,
  PersonaFeedbackSourceView,
  PersonaOperationRecordView,
  WorldGrowthSourceView,
} from '../../shared/types/learning'

/** 新建或覆盖一份成长素材的持久化命令。 */
export interface SaveGrowthMaterialRecord {
  /** 素材 UUID。 */
  id: string
  /** 所属对象类型。 */
  subjectType: 'world' | 'persona'
  /** 所属对象 UUID。 */
  subjectId: string
  /** 素材标题。 */
  title: string
  /** 固定正文快照。 */
  content: string
  /** 素材来源类型。 */
  sourceType: 'source_material' | 'manual' | 'legacy'
  /** 来源资料 UUID。 */
  sourceId: string | null
  /** 导入时来源正文 SHA-256。 */
  sourceHash: string | null
  /** AI 提炼权重。 */
  importance: number
  /** 创建或更新时间。 */
  timestamp: number
}

/** 保存学习提示词草稿的持久化命令。 */
export interface SaveLearningPromptDraftRecord {
  /** 提示词类型。 */
  promptType: LearningPromptType
  /** 所属对象 UUID。 */
  subjectId: string
  /** 首次创建提示词容器时使用的 UUID。 */
  promptId: string
  /** 首次创建草稿时使用的 UUID。 */
  draftId: string
  /** 草稿基线版本 UUID。 */
  baseVersionId: string | null
  /** 完整提示词正文。 */
  promptText: string
  /** 来源分析批次 UUID。 */
  sourceAnalysisBatchId: string | null
  /** 草稿来源。 */
  createdBy: 'analysis' | 'user' | 'migration'
  /** 保存时间。 */
  timestamp: number
}

/** 发布当前学习提示词草稿的持久化命令。 */
export interface PublishLearningPromptDraftRecord {
  /** 提示词类型。 */
  promptType: LearningPromptType
  /** 所属对象 UUID。 */
  subjectId: string
  /** 新版本 UUID。 */
  versionId: string
  /** 用户填写的变更说明。 */
  changeSummary: string
  /** 发布时间。 */
  timestamp: number
}

/** 创建人物反馈资料的持久化命令。 */
export interface CreatePersonaFeedbackSourceRecord {
  /** 新记录 UUID。 */
  id: string
  /** 所属人物 UUID。 */
  personaId: string
  /** 展示标题。 */
  title: string
  /** 完整正文。 */
  content: string
  /** 来源类型。 */
  sourceType: 'run_feedback' | 'manual' | 'imported' | 'memory_conversion'
  /** 原始业务记录 UUID。 */
  sourceId: string | null
  /** 创建时间。 */
  timestamp: number
}

/** 创建成长及第一版不可变修订的持久化命令。 */
export interface CreateGrowthRecord {
  /** 稳定成长 UUID。 */
  id: string
  /** 第一版修订 UUID。 */
  revisionId: string
  /** 所属对象类型。 */
  subjectType: 'world' | 'persona'
  /** 所属对象 UUID。 */
  subjectId: string
  /** 成长正文。 */
  content: string
  /** 适用范围。 */
  scope: string
  /** 重要程度。 */
  importance: number
  /** 当前原始资料 UUID。 */
  sourceIds: string[]
  /** 创建时间。 */
  timestamp: number
}

/** 创建成长新修订的持久化命令。 */
export interface UpdateGrowthRecord {
  /** 稳定成长 UUID。 */
  id: string
  /** 新修订 UUID。 */
  revisionId: string
  /** 所属对象类型。 */
  subjectType: 'world' | 'persona'
  /** 所属对象 UUID。 */
  subjectId: string
  /** 新成长正文。 */
  content: string
  /** 新适用范围。 */
  scope: string
  /** 新重要程度。 */
  importance: number
  /** 修订时间。 */
  timestamp: number
}

/** 创建人物处理记录的持久化命令。 */
export interface CreatePersonaOperationRecord {
  /** 处理记录 UUID。 */
  id: string
  /** 所属人物 UUID。 */
  personaId: string
  /** 对应运行 UUID。 */
  runId: string
  /** 处理类型。 */
  operationType: 'interest_assessment' | 'artifact_generation' | 'content_analysis'
  /** 便于检索的结果摘要。 */
  resultSummary: string
  /** 选择、评分或兴趣结论。 */
  decision: Record<string, unknown> | null
  /** 当时使用的心智和证据标识快照。 */
  contextSnapshot: Record<string, unknown>
  /** 创建时间。 */
  timestamp: number
}

/** 新建或修改人物第三方经历记录的持久化命令。 */
export interface SavePersonaExternalRecord {
  /** 第三方记录 UUID。 */
  id: string
  /** 所属人物 UUID。 */
  personaId: string
  /** 事件发生日期，格式为 YYYY-MM-DD。 */
  occurredOn: string
  /** 人物做过的事情。 */
  content: string
  /** 第三方来源名称与地址。 */
  references: Array<{ name: string, address: string }>
  /** AI 提炼记忆时的人工权重。 */
  importance: number
  /** 创建或更新时间。 */
  timestamp: number
}

/** 统一成长与记忆事实源端口。 */
export interface LearningRepository {
  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @returns 当前成长素材。 */
  listGrowthMaterials(subjectType: 'world' | 'persona', subjectId: string): Promise<GrowthMaterialView[]>
  /** @param records 已校验的资料库素材。 @returns 新建或刷新完成时结束。 */
  importGrowthMaterials(records: SaveGrowthMaterialRecord[]): Promise<void>
  /** @param record 手工成长素材。 @returns 保存完成时结束。 */
  createGrowthMaterial(record: SaveGrowthMaterialRecord): Promise<void>
  /** @param record 已校验的成长素材新内容。 @returns 更新成功时为 true。 */
  updateGrowthMaterial(record: SaveGrowthMaterialRecord): Promise<boolean>
  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param ids 素材 UUID。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  updateGrowthMaterialStates(subjectType: 'world' | 'persona', subjectId: string, ids: string[], isEnabled: boolean, timestamp: number): Promise<number>
  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param ids 素材 UUID。 @param timestamp 删除时间。 @returns 删除数量。 */
  deleteGrowthMaterials(subjectType: 'world' | 'persona', subjectId: string, ids: string[], timestamp: number): Promise<number>

  /** @param promptType 提示词类型。 @param subjectId 对象 UUID。 @returns 当前提示词工作区或 null。 */
  findLearningPromptWorkspace(promptType: LearningPromptType, subjectId: string): Promise<LearningPromptWorkspaceView | null>
  /** @param record 草稿保存命令。 @returns 保存后的提示词工作区。 */
  saveLearningPromptDraft(record: SaveLearningPromptDraftRecord): Promise<LearningPromptWorkspaceView>
  /** @param promptType 提示词类型。 @param subjectId 对象 UUID。 @returns 删除数量。 */
  deleteLearningPromptDraft(promptType: LearningPromptType, subjectId: string): Promise<number>
  /** @param promptType 提示词类型。 @param subjectId 对象 UUID。 @param versionId 历史版本 UUID。 @returns 归属正确的历史版本或 null。 */
  findLearningPromptVersion(promptType: LearningPromptType, subjectId: string, versionId: string): Promise<LearningPromptVersionView | null>
  /** @param record 草稿发布命令。 @returns 新发布版本或 null。 */
  publishLearningPromptDraft(record: PublishLearningPromptDraftRecord): Promise<LearningPromptVersionView | null>
  /** @param promptType 提示词类型。 @param subjectId 对象 UUID。 @returns 当前已发布完整提示词正文或 null。 */
  findActiveLearningPromptText(promptType: LearningPromptType, subjectId: string): Promise<string | null>

  /** @param worldId 世界 UUID。 @returns 世界资料及成长启用状态。 */
  listWorldGrowthSources(worldId: string): Promise<WorldGrowthSourceView[]>
  /** @param worldId 世界 UUID。 @param ids 资料 UUID。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  updateWorldGrowthSourceStates(worldId: string, ids: string[], isEnabled: boolean, timestamp: number): Promise<number>

  /** @param personaId 人物 UUID。 @returns 人物反馈资料。 */
  listPersonaFeedbackSources(personaId: string): Promise<PersonaFeedbackSourceView[]>
  /** @param record 创建命令。 @returns 无返回值。 */
  createPersonaFeedbackSource(record: CreatePersonaFeedbackSourceRecord): Promise<void>
  /** @param personaId 人物 UUID。 @param ids 反馈资料 UUID。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  updatePersonaFeedbackSourceStates(personaId: string, ids: string[], isEnabled: boolean, timestamp: number): Promise<number>
  /** @param personaId 人物 UUID。 @param ids 反馈资料 UUID。 @param timestamp 删除时间。 @param deferRemoteDeletion 是否先等待 OpenViking 删除。 @returns 已受理数量。 */
  deletePersonaFeedbackSources(personaId: string, ids: string[], timestamp: number, deferRemoteDeletion: boolean): Promise<number>

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @returns 当前成长修订。 */
  listGrowth(subjectType: 'world' | 'persona', subjectId: string): Promise<GrowthRecordView[]>
  /** @param record 创建命令。 @returns 无返回值。 */
  createGrowth(record: CreateGrowthRecord): Promise<void>
  /** @param records 已完整校验的批量创建命令。 @returns 整批原子创建完成时结束。 */
  createGrowthBatch(records: CreateGrowthRecord[]): Promise<void>
  /** @param record 新修订命令。 @returns 成长存在且修订成功时为 true。 */
  updateGrowth(record: UpdateGrowthRecord): Promise<boolean>
  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param ids 成长 UUID。 @param status 目标状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  updateGrowthStates(subjectType: 'world' | 'persona', subjectId: string, ids: string[], status: 'active' | 'archived' | 'rejected', timestamp: number): Promise<number>
  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param ids 成长 UUID。 @param timestamp 删除时间。 @returns 原子删除数量。 */
  deleteGrowth(subjectType: 'world' | 'persona', subjectId: string, ids: string[], timestamp: number): Promise<number>

  /** @param personaId 人物 UUID。 @returns 人物处理记录。 */
  listPersonaOperationRecords(personaId: string): Promise<PersonaOperationRecordView[]>
  /** @param record 创建命令。 @returns 首次创建时为 true，运行已有记录时为 false。 */
  createPersonaOperationRecord(record: CreatePersonaOperationRecord): Promise<boolean>
  /** @param personaId 人物 UUID。 @param ids 处理记录 UUID。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  updatePersonaOperationRecordStates(personaId: string, ids: string[], isEnabled: boolean, timestamp: number): Promise<number>
  /** @param personaId 人物 UUID。 @param recordId 处理记录 UUID。 @param importance 新评分。 @param timestamp 更新时间。 @returns 是否更新。 */
  updatePersonaOperationRecordImportance(personaId: string, recordId: string, importance: number, timestamp: number): Promise<boolean>
  /** @param personaId 人物 UUID。 @returns 人工补充的第三方经历记录。 */
  listPersonaExternalRecords(personaId: string): Promise<PersonaExternalRecordView[]>
  /** @param record 新第三方经历记录。 @returns 创建完成时结束。 */
  createPersonaExternalRecord(record: SavePersonaExternalRecord): Promise<void>
  /** @param record 已存在第三方经历记录的新内容。 @returns 记录存在且归属正确时为 true。 */
  updatePersonaExternalRecord(record: SavePersonaExternalRecord): Promise<boolean>
  /** @param personaId 人物 UUID。 @param ids 第三方记录 UUID。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  updatePersonaExternalRecordStates(personaId: string, ids: string[], isEnabled: boolean, timestamp: number): Promise<number>
  /** @param personaId 人物 UUID。 @param ids 第三方记录 UUID。 @param timestamp 删除时间。 @returns 删除数量。 */
  deletePersonaExternalRecords(personaId: string, ids: string[], timestamp: number): Promise<number>
  /** @param personaId 人物 UUID。 @returns 当前启用的 OpenViking 派生记忆分析素材。 */
  listOpenVikingDerivedMemories(personaId: string): Promise<OpenVikingDerivedMemoryView[]>

  /** @param personaId 人物 UUID。 @returns 人物当前记忆修订。 */
  listMemories(personaId: string): Promise<MemoryRecordView[]>
  /** @param personaId 人物 UUID。 @param ids 记忆 UUID。 @param status 目标状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  updateMemoryStates(personaId: string, ids: string[], status: 'active' | 'archived' | 'rejected', timestamp: number): Promise<number>
  /** @param personaId 人物 UUID。 @param memoryId 记忆 UUID。 @param feedbackId 新反馈 UUID。 @param timestamp 创建时间。 @returns 新反馈资料或 null。 */
  convertMemoryToFeedbackSource(personaId: string, memoryId: string, feedbackId: string, timestamp: number): Promise<PersonaFeedbackSourceView | null>
}
