import type { SourceRole } from '../domain/content/ContentModels'
import type { ContextSyncRecordPageView, ContextSyncRecordView, ContextSyncSummaryView, OpenVikingSyncRuntimeView } from '../../shared/types/context'

/** OpenViking 同步使用的完整 SQLite 资料事实。 */
export interface ContextSourceDocument {
  /** SQLite 投影实体类型。 */
  entityType: 'source_material' | 'persona_feedback_source'
  id: string
  name: string
  role: SourceRole | 'feedback'
  contentHash: string
  contentText: string
}

/** 检索时用于限制人物和世界资料范围的元数据。 */
export interface ContextSourceScope {
  sourceId: string
  role: SourceRole
  priority: number
}

/** SQLite 资料向一个 OpenViking User 或 Peer 产生的独立投影。 */
export interface ContextSourceProjection {
  /** SQLite 资料事实。 */
  source: ContextSourceDocument
  /** 世界资料写入 User，人物资料写入 Peer。 */
  scopeType: 'world' | 'persona' | 'global'
  /** 世界或人物 UUID。 */
  scopeId: string
  /** OpenViking 世界 User。 */
  userId: string
  /** 人物 Peer；世界投影为空。 */
  peerId: string | null
  /** 数值越小，检索优先级越高。 */
  priority: number
  /** 当前投影应写入还是删除。 */
  operation: 'upsert' | 'delete'
  /** 按实体类型和范围生成的稳定远端 URI。 */
  remoteUri: string
}

/** 可由持久任务定位的 OpenViking Resource 投影实体。 */
export type ContextProjectionEntityType = ContextSourceDocument['entityType']

/** 一次人物检索允许访问的精确远端目标。 */
export interface ContextRemoteSearchScope {
  /** 当前人物所在世界或独立人物对应的 OpenViking User。 */
  userId: string
  /** 当前人物对应的 OpenViking Peer。 */
  peerId: string
  /** SQLite 当前关联资料是否都至少有一份成功远端投影。 */
  complete: boolean
  /** 仅包含 SQLite 当前有效范围且同步成功的 URI。 */
  targets: Array<{
    /** SQLite 资料 UUID；人物记忆不是资料，因此为空。 */
    sourceId: string | null
    /** 资料角色或有效人物记忆。 */
    role: ContextSourceScope['role'] | 'memory'
    /** 数值越小越优先。 */
    priority: number
    /** SQLite 允许本次检索使用的精确 URI。 */
    remoteUri: string
  }>
}

/** 待写入人物 Peer Session 的 SQLite 交流事实。 */
export interface ContextSessionExchange {
  /** 本地来源类型。 */
  sourceType: 'run' | 'feedback'
  /** 生成运行或反馈 UUID。 */
  sourceId: string
  /** 人物 UUID。 */
  personaId: string
  /** OpenViking 世界 User。 */
  userId: string
  /** OpenViking 人物 Peer。 */
  peerId: string
  /** 远端稳定 Session UUID。 */
  sessionId: string
  /** 用户输入。 */
  userContent: string
  /** 人物响应或反馈上下文。 */
  assistantContent: string
  /** 是否允许只提取 Peer events 候选记忆。 */
  extractMemory: boolean
}

/** OpenViking 自动提取后同步回 SQLite 的候选记忆。 */
export interface DerivedMemoryDocument {
  /** OpenViking 精确 URI。 */
  remoteUri: string
  /** 记忆类型目录。 */
  memoryType: string
  /** 完整可见正文。 */
  content: string
  /** 正文 SHA-256。 */
  contentHash: string
}

/** 尚无远端 URI 但已由 SQLite 审核生效的成长或记忆。 */
export interface ActiveLocalLearning {
  /** 成长或记忆业务 UUID。 */
  id: string
  /** 区分世界成长、人物成长和人物记忆。 */
  entityType: 'world_growth' | 'persona_growth' | 'persona_memory'
  /** 成长或记忆。 */
  role: 'growth' | 'memory'
  /** 完整正文。 */
  content: string
  /** 正文 SHA-256。 */
  contentHash: string
}

/** 启动补偿扫描发现的 Session 本地来源。 */
export interface PendingContextSessionSource {
  /** 生成运行或反馈。 */
  sourceType: 'run' | 'feedback'
  /** 对应 SQLite 事实 UUID。 */
  sourceId: string
}

/** 同步日志分页查询参数。 */
export interface ListSyncRecordPageInput {
  /** 从 1 开始的页码。 */
  page: number
  /** 每页记录数。 */
  pageSize: 5 | 10 | 20 | 50 | 100
}

/** SQLite 上下文同步记录和资料目录端口。 */
export interface ContextIndexRepository {
  /** @returns SQLite 当前全部世界 User；无世界人物统一使用 default，不创建额外 User。 */
  listTargetUserIds(): Promise<string[]>
  /** @returns 全部 SQLite 资料正文；SQLite 始终是唯一事实源。 */
  listSourceDocuments(): Promise<ContextSourceDocument[]>
  /** @param sourceId 资料 UUID。 @returns 当前完整 SQLite 资料；不存在时返回 null。 */
  findSourceDocument(sourceId: string): Promise<ContextSourceDocument | null>
  /** @param entityType 可选实体类型。 @param sourceId 可选实体 UUID；均为空时返回全部投影。 @returns SQLite 可重建投影及删除意图。 */
  listSourceProjections(entityType?: ContextProjectionEntityType, sourceId?: string): Promise<ContextSourceProjection[]>
  /** @param personaId 人物 UUID。 @param worldId 可选世界 UUID。 @returns 允许当前运行检索的资料范围。 */
  listSourceScopes(personaId: string, worldId: string | null): Promise<ContextSourceScope[]>
  /** @param personaId 人物 UUID。 @param worldId 可选世界 UUID。 @returns 同一 User 下可检索的精确远端范围。 */
  findRemoteSearchScope(personaId: string, worldId: string | null): Promise<ContextRemoteSearchScope | null>
  /** @param personaId 人物 UUID。 @returns 尚无远端投影但已生效的成长和记忆。 */
  listActiveLocalLearning(personaId: string): Promise<ActiveLocalLearning[]>
  /** @param sourceType 本地交流类型。 @param sourceId 本地 UUID。 @returns 完整交流事实或 null。 */
  findSessionExchange(sourceType: 'run' | 'feedback', sourceId: string): Promise<ContextSessionExchange | null>
  /** @returns 尚未成功写入 OpenViking 的全部终态运行和反馈来源。 */
  listPendingSessionSources(): Promise<PendingContextSessionSource[]>
  /** @param timestamp 重建开始时间。 @returns 把既有 Session 投影改为待重放，同时保留已同步回 SQLite 的候选记忆。 */
  markSessionsForRebuild(timestamp: number): Promise<void>
  /** @param timestamp 切换 Account 后的重建时间。 @returns 全部资料投影改为待重放后结束。 */
  markSourceProjectionsForRebuild(timestamp: number): Promise<void>
  /** @param exchange 本地交流。 @param status 投影状态。 @param error 可选脱敏错误。 @param timestamp 更新时间。 @returns 无返回值。 */
  saveSessionState(exchange: ContextSessionExchange, status: 'pending' | 'failed', error: string | null, timestamp: number): Promise<void>
  /** @param exchange 已成功同步的交流。 @param memories OpenViking 派生候选。 @param timestamp 同步时间。 @returns 无返回值。 */
  saveSessionResult(exchange: ContextSessionExchange, memories: DerivedMemoryDocument[], timestamp: number): Promise<void>
  /** @param sourceId 已完成远端删除的人物反馈资料 UUID。 @param timestamp 完成时间。 @returns 本地正文和活动行清理完成时结束。 */
  finalizePersonaFeedbackSourceDeletion(sourceId: string, timestamp: number): Promise<void>
  /** @returns 全部 OpenViking 同步记录。 */
  listSyncRecords(): Promise<ContextSyncRecordView[]>
  /** @param input 分页参数。 @returns 最近更新在前的同步日志分页结果。 */
  listSyncRecordsPage(input: ListSyncRecordPageInput): Promise<ContextSyncRecordPageView>
  /** @returns 当前同步失败记录数。 */
  countFailedSyncRecords(): Promise<number>
  /** @returns 当前失败分类和全局降级状态。 */
  getSyncSummary(): Promise<ContextSyncSummaryView>
  /** @returns 当前持久化写入熔断状态。 */
  getSyncRuntime(): Promise<OpenVikingSyncRuntimeView>
  /** @param error 脱敏错误。 @param retryAfter 下次探测时间。 @param timestamp 状态更新时间。 @returns 降级状态。 */
  markSyncDegraded(error: string, retryAfter: number | null, timestamp: number): Promise<OpenVikingSyncRuntimeView>
  /** @param timestamp 状态更新时间。 @returns 恢复后的健康状态。 */
  markSyncHealthy(timestamp: number): Promise<OpenVikingSyncRuntimeView>
  /** @param timestamp 立即允许管理员触发的恢复探测。 @returns 更新后的状态。 */
  allowImmediateSyncRetry(timestamp: number): Promise<void>
  /** @param record 完整同步事实。 @returns 无返回值。 */
  saveSyncRecord(record: ContextSyncRecordView): Promise<void>
  /** @param id 已完成远端删除的投影记录 UUID。 @returns 无返回值。 */
  deleteSyncRecord(id: string): Promise<void>
}
