import type {
  GrowthRecordView,
  MemoryRecordView,
  OpenVikingDerivedMemoryView,
  PersonaFeedbackSourceView,
  PersonaOperationRecordView,
  WorldGrowthSourceView,
} from '../../shared/types/learning'

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

/** 统一成长与记忆事实源端口。 */
export interface LearningRepository {
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
  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param ids 成长 UUID。 @param status 目标状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  updateGrowthStates(subjectType: 'world' | 'persona', subjectId: string, ids: string[], status: 'active' | 'archived' | 'rejected', timestamp: number): Promise<number>

  /** @param personaId 人物 UUID。 @returns 人物处理记录。 */
  listPersonaOperationRecords(personaId: string): Promise<PersonaOperationRecordView[]>
  /** @param record 创建命令。 @returns 首次创建时为 true，运行已有记录时为 false。 */
  createPersonaOperationRecord(record: CreatePersonaOperationRecord): Promise<boolean>
  /** @param personaId 人物 UUID。 @param ids 处理记录 UUID。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  updatePersonaOperationRecordStates(personaId: string, ids: string[], isEnabled: boolean, timestamp: number): Promise<number>
  /** @param personaId 人物 UUID。 @returns 当前启用的 OpenViking 派生记忆分析素材。 */
  listOpenVikingDerivedMemories(personaId: string): Promise<OpenVikingDerivedMemoryView[]>

  /** @param personaId 人物 UUID。 @returns 人物当前记忆修订。 */
  listMemories(personaId: string): Promise<MemoryRecordView[]>
  /** @param personaId 人物 UUID。 @param ids 记忆 UUID。 @param status 目标状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  updateMemoryStates(personaId: string, ids: string[], status: 'active' | 'archived' | 'rejected', timestamp: number): Promise<number>
  /** @param personaId 人物 UUID。 @param memoryId 记忆 UUID。 @param feedbackId 新反馈 UUID。 @param timestamp 创建时间。 @returns 新反馈资料或 null。 */
  convertMemoryToFeedbackSource(personaId: string, memoryId: string, feedbackId: string, timestamp: number): Promise<PersonaFeedbackSourceView | null>
}
