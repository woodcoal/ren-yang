import type { SourceRole } from '../domain/content/ContentModels'
import type { ContextSyncRecordView } from '../../shared/types/context'

/** OpenViking 同步使用的完整 SQLite 资料事实。 */
export interface ContextSourceDocument {
  id: string
  name: string
  role: SourceRole
  contentHash: string
  contentText: string
}

/** 检索时用于限制人物和世界资料范围的元数据。 */
export interface ContextSourceScope {
  sourceId: string
  role: SourceRole
  priority: number
}

/** SQLite 上下文同步记录和资料目录端口。 */
export interface ContextIndexRepository {
  /** @returns 全部 SQLite 资料正文；SQLite 始终是唯一事实源。 */
  listSourceDocuments(): Promise<ContextSourceDocument[]>
  /** @param sourceId 资料 UUID。 @returns 当前完整 SQLite 资料；不存在时返回 null。 */
  findSourceDocument(sourceId: string): Promise<ContextSourceDocument | null>
  /** @param personaId 人物 UUID。 @param worldId 可选世界 UUID。 @returns 允许当前运行检索的资料范围。 */
  listSourceScopes(personaId: string, worldId: string | null): Promise<ContextSourceScope[]>
  /** @returns 全部 OpenViking 同步记录。 */
  listSyncRecords(): Promise<ContextSyncRecordView[]>
  /** @param record 完整同步事实。 @returns 无返回值。 */
  saveSyncRecord(record: ContextSyncRecordView): Promise<void>
}
