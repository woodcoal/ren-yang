import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { ContextSyncRecordView } from '../../../shared/types/context'
import type {
  ContextIndexRepository,
  ContextSourceDocument,
  ContextSourceScope,
} from '../../ports/ContextIndexRepository'

/** 使用 SQLite 保存 OpenViking 可重建同步状态和检索范围。 */
export class SqliteContextIndexRepository implements ContextIndexRepository {
  /**
   * 创建上下文索引仓储。
   * @param client 已迁移 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @returns 全部 SQLite 资料完整正文。 */
  async listSourceDocuments(): Promise<ContextSourceDocument[]> {
    return this.client.prepare(`
      SELECT id, name, role, content_hash, content_text FROM source_materials ORDER BY created_at, id
    `).all().map((value) => {
      const data = row(value)
      return {
        id: String(data.id),
        name: String(data.name),
        role: data.role as ContextSourceDocument['role'],
        contentHash: String(data.content_hash),
        contentText: String(data.content_text),
      }
    })
  }

  /** @param sourceId 资料 UUID。 @returns 当前完整 SQLite 资料；不存在时返回 null。 */
  async findSourceDocument(sourceId: string): Promise<ContextSourceDocument | null> {
    const value = this.client.prepare(`
      SELECT id, name, role, content_hash, content_text FROM source_materials WHERE id = ?
    `).get(sourceId)
    if (!value) return null
    const data = row(value)
    return {
      id: String(data.id),
      name: String(data.name),
      role: data.role as ContextSourceDocument['role'],
      contentHash: String(data.content_hash),
      contentText: String(data.content_text),
    }
  }

  /** @param personaId 人物 UUID。 @param worldId 可选世界 UUID。 @returns 去重后的关联资料范围。 */
  async listSourceScopes(personaId: string, worldId: string | null): Promise<ContextSourceScope[]> {
    return this.client.prepare(`
      WITH linked_sources AS (
        SELECT source_id, MIN(priority) AS priority FROM (
          SELECT source_id, priority FROM persona_sources WHERE persona_id = ?
          UNION ALL
          SELECT source_id, priority FROM world_sources WHERE world_id = ?
        ) GROUP BY source_id
      )
      SELECT linked_sources.source_id, source_materials.role, linked_sources.priority
      FROM linked_sources
      INNER JOIN source_materials ON source_materials.id = linked_sources.source_id
      ORDER BY CASE source_materials.role WHEN 'canon_fact' THEN 0 WHEN 'style_sample' THEN 1 ELSE 2 END,
        linked_sources.priority, linked_sources.source_id
    `).all(personaId, worldId ?? '').map((value) => {
      const data = row(value)
      return {
        sourceId: String(data.source_id),
        role: data.role as ContextSourceScope['role'],
        priority: Number(data.priority),
      }
    })
  }

  /** @returns 全部 OpenViking 同步记录。 */
  async listSyncRecords(): Promise<ContextSyncRecordView[]> {
    return this.client.prepare(`SELECT * FROM context_sync_records ORDER BY updated_at DESC, source_id`).all()
      .map(toSyncRecord)
  }

  /** @param record 完整同步事实。 @returns 无返回值。 */
  async saveSyncRecord(record: ContextSyncRecordView): Promise<void> {
    this.client.prepare(`
      INSERT INTO context_sync_records (
        id, source_id, provider, remote_uri, content_hash, status, error, created_at, updated_at
      ) VALUES (?, ?, 'openviking', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, provider) DO UPDATE SET
        remote_uri = excluded.remote_uri,
        content_hash = excluded.content_hash,
        status = excluded.status,
        error = excluded.error,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.sourceId,
      record.remoteUri,
      record.contentHash,
      record.status,
      record.error,
      record.createdAt,
      record.updatedAt,
    )
  }
}

/** @param value SQLite 行。 @returns 键值行。 */
function row(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

/** @param value SQLite 行。 @returns OpenViking 同步记录。 */
function toSyncRecord(value: unknown): ContextSyncRecordView {
  const data = row(value)
  return {
    id: String(data.id),
    sourceId: String(data.source_id),
    provider: 'openviking',
    remoteUri: data.remote_uri === null ? null : String(data.remote_uri),
    contentHash: String(data.content_hash),
    status: data.status as ContextSyncRecordView['status'],
    error: data.error === null ? null : String(data.error),
    createdAt: Number(data.created_at),
    updatedAt: Number(data.updated_at),
  }
}
