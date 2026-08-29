import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { ContextSyncRecordView } from '../../../shared/types/context'
import type {
  ContextIndexRepository,
  ActiveLocalLearning,
  ContextSessionExchange,
  ContextSourceDocument,
  ContextSourceProjection,
  ContextSourceScope,
  DerivedMemoryDocument,
  PendingContextSessionSource,
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

  /** @param sourceId 可选资料 UUID。 @returns 由当前世界和人物关联展开的全部独立投影。 */
  async listSourceProjections(sourceId?: string): Promise<ContextSourceProjection[]> {
    const filter = sourceId ? 'WHERE source_materials.id = ?' : ''
    const parameters = sourceId ? [sourceId] : []
    return this.client.prepare(`
      SELECT source_materials.id, source_materials.name, source_materials.role,
        source_materials.content_hash, source_materials.content_text,
        'world' AS scope_type, worlds.id AS scope_id,
        'world-' || worlds.id AS user_id, NULL AS peer_id, world_sources.priority
      FROM world_sources
      INNER JOIN worlds ON worlds.id = world_sources.world_id
      INNER JOIN source_materials ON source_materials.id = world_sources.source_id
      ${filter}
      UNION ALL
      SELECT source_materials.id, source_materials.name, source_materials.role,
        source_materials.content_hash, source_materials.content_text,
        'persona' AS scope_type, personas.id AS scope_id,
        CASE WHEN personas.world_id IS NULL THEN 'standalone-' || personas.id ELSE 'world-' || personas.world_id END AS user_id,
        'persona-' || personas.id AS peer_id, persona_sources.priority
      FROM persona_sources
      INNER JOIN personas ON personas.id = persona_sources.persona_id
      INNER JOIN source_materials ON source_materials.id = persona_sources.source_id
      ${filter}
      ORDER BY 6, 7, 1
    `).all(...parameters, ...parameters).map(toProjection)
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

  /** @param personaId 人物 UUID。 @param worldId 可选世界 UUID。 @returns 当前有效且已同步的精确 URI 范围。 */
  async findRemoteSearchScope(personaId: string, worldId: string | null) {
    const persona = this.client.prepare('SELECT world_id FROM personas WHERE id = ?').get(personaId) as { world_id: string | null } | undefined
    if (!persona) return null
    const effectiveWorldId = worldId ?? persona.world_id
    const userId = effectiveWorldId ? `world-${effectiveWorldId}` : `standalone-${personaId}`
    const peerId = `persona-${personaId}`
    const sourceTargets = this.client.prepare(`
      SELECT context_sync_records.source_id, source_materials.role,
        CASE context_sync_records.scope_type WHEN 'persona' THEN persona_sources.priority ELSE world_sources.priority END AS priority,
        context_sync_records.remote_uri
      FROM context_sync_records
      INNER JOIN source_materials ON source_materials.id = context_sync_records.source_id
      LEFT JOIN persona_sources ON context_sync_records.scope_type = 'persona'
        AND persona_sources.persona_id = ? AND persona_sources.source_id = context_sync_records.source_id
      LEFT JOIN world_sources ON context_sync_records.scope_type = 'world'
        AND world_sources.world_id = ? AND world_sources.source_id = context_sync_records.source_id
      WHERE context_sync_records.provider = 'openviking'
        AND context_sync_records.status = 'synchronized'
        AND context_sync_records.user_id = ?
        AND context_sync_records.remote_uri IS NOT NULL
        AND ((context_sync_records.scope_type = 'persona' AND context_sync_records.scope_id = ? AND persona_sources.source_id IS NOT NULL)
          OR (context_sync_records.scope_type = 'world' AND context_sync_records.scope_id = ? AND world_sources.source_id IS NOT NULL))
      ORDER BY CASE source_materials.role WHEN 'canon_fact' THEN 0 WHEN 'style_sample' THEN 1 ELSE 2 END,
        priority, context_sync_records.source_id
    `).all(personaId, effectiveWorldId ?? '', userId, personaId, effectiveWorldId ?? '').map((value) => {
      const data = row(value)
      return {
        sourceId: String(data.source_id),
        role: data.role as ContextSourceScope['role'],
        priority: Number(data.priority),
        remoteUri: String(data.remote_uri),
      }
    })
    const memoryTargets = this.client.prepare(`
      SELECT remote_uri FROM persona_memories
      WHERE persona_id = ? AND status = 'active' AND remote_uri IS NOT NULL
      ORDER BY updated_at DESC, id
    `).all(personaId).map((value) => ({
      sourceId: null,
      role: 'memory' as const,
      priority: 0,
      remoteUri: String(row(value).remote_uri),
    }))
    return { userId, peerId, targets: [...memoryTargets, ...sourceTargets] }
  }

  /** @param personaId 人物 UUID。 @returns 没有远端 URI但必须参与提示的有效成长和记忆。 */
  async listActiveLocalLearning(personaId: string): Promise<ActiveLocalLearning[]> {
    return this.client.prepare(`
      SELECT 'memory' AS role, content, content_hash FROM persona_memories
      WHERE persona_id = ? AND status = 'active' AND remote_uri IS NULL
      UNION ALL
      SELECT 'growth' AS role, content, content_hash FROM persona_growth_records
      WHERE persona_id = ? AND status = 'active'
      ORDER BY role, content_hash
    `).all(personaId, personaId).map((value) => {
      const data = row(value)
      return {
        role: data.role as ActiveLocalLearning['role'],
        content: String(data.content),
        contentHash: String(data.content_hash),
      }
    })
  }

  /** @param sourceType 生成运行或反馈。 @param sourceId 本地事实 UUID。 @returns 可投影交流或 null。 */
  async findSessionExchange(sourceType: 'run' | 'feedback', sourceId: string): Promise<ContextSessionExchange | null> {
    const value = sourceType === 'run'
      ? this.client.prepare(`
          SELECT generation_runs.id, generation_runs.input_json, generation_runs.result_json,
            personas.id AS persona_id, personas.world_id,
            GROUP_CONCAT(block_attempts.output_text, '\n\n') AS block_output
          FROM generation_runs
          INNER JOIN persona_versions ON persona_versions.id = generation_runs.persona_version_id
          INNER JOIN personas ON personas.id = persona_versions.persona_id
          LEFT JOIN artifact_documents ON artifact_documents.run_id = generation_runs.id
          LEFT JOIN artifact_blocks ON artifact_blocks.document_id = artifact_documents.id
          LEFT JOIN block_attempts ON block_attempts.id = artifact_blocks.selected_attempt_id
          WHERE generation_runs.id = ? AND generation_runs.status IN ('succeeded', 'partial', 'failed')
          GROUP BY generation_runs.id
        `).get(sourceId)
      : this.client.prepare(`
          SELECT feedback_events.id, feedback_events.content, feedback_events.edited_output,
            personas.id AS persona_id, personas.world_id
          FROM feedback_events
          INNER JOIN generation_runs ON generation_runs.id = feedback_events.run_id
          INNER JOIN persona_versions ON persona_versions.id = generation_runs.persona_version_id
          INNER JOIN personas ON personas.id = persona_versions.persona_id
          WHERE feedback_events.id = ?
        `).get(sourceId)
    if (!value) return null
    const data = row(value)
    const personaId = String(data.persona_id)
    const worldId = data.world_id === null ? null : String(data.world_id)
    const input = sourceType === 'run' ? JSON.parse(String(data.input_json)) as Record<string, unknown> : null
    const userContent = sourceType === 'run'
      ? String(input?.content ?? input?.requirement ?? '')
      : String(data.content)
    const assistantContent = sourceType === 'run'
      ? String(data.result_json ?? data.block_output ?? '本次运行未产生可用结果。')
      : String(data.edited_output ?? '已收到并记录这条人物反馈。')
    return {
      sourceType,
      sourceId,
      personaId,
      userId: worldId ? `world-${worldId}` : `standalone-${personaId}`,
      peerId: `persona-${personaId}`,
      sessionId: `ren-yang-${sourceType}-${sourceId}`,
      userContent,
      assistantContent,
      extractMemory: sourceType === 'feedback',
    }
  }

  /** @returns 没有成功同步状态的终态运行和反馈，用于进程重启后补回丢失任务。 */
  async listPendingSessionSources(): Promise<PendingContextSessionSource[]> {
    return this.client.prepare(`
      SELECT 'run' AS source_type, generation_runs.id AS source_id
      FROM generation_runs
      WHERE generation_runs.status IN ('succeeded', 'partial', 'failed')
        AND NOT EXISTS (
          SELECT 1 FROM openviking_session_records
          WHERE source_type = 'run' AND source_id = generation_runs.id AND status = 'synchronized'
        )
      UNION ALL
      SELECT 'feedback' AS source_type, feedback_events.id AS source_id
      FROM feedback_events
      WHERE NOT EXISTS (
        SELECT 1 FROM openviking_session_records
        WHERE source_type = 'feedback' AND source_id = feedback_events.id AND status = 'synchronized'
      )
      ORDER BY source_type, source_id
    `).all().map((value) => {
      const data = row(value)
      return {
        sourceType: data.source_type as PendingContextSessionSource['sourceType'],
        sourceId: String(data.source_id),
      }
    })
  }

  /** @param exchange 本地交流。 @param status 待处理或失败。 @param error 脱敏错误。 @param timestamp 更新时间。 @returns 无返回值。 */
  async saveSessionState(exchange: ContextSessionExchange, status: 'pending' | 'failed', error: string | null, timestamp: number): Promise<void> {
    this.client.prepare(`
      INSERT INTO openviking_session_records (
        id, source_type, source_id, persona_id, user_id, peer_id, remote_session_id,
        status, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_type, source_id) DO UPDATE SET
        persona_id = excluded.persona_id, user_id = excluded.user_id, peer_id = excluded.peer_id,
        remote_session_id = excluded.remote_session_id, status = excluded.status,
        error = excluded.error, updated_at = excluded.updated_at
    `).run(
      exchange.sessionId, exchange.sourceType, exchange.sourceId, exchange.personaId,
      exchange.userId, exchange.peerId, exchange.sessionId, status, error,
      timestamp, timestamp,
    )
  }

  /** @param exchange 已同步交流。 @param memories 派生记忆候选。 @param timestamp 完成时间。 @returns 原子保存状态和候选。 */
  async saveSessionResult(exchange: ContextSessionExchange, memories: DerivedMemoryDocument[], timestamp: number): Promise<void> {
    this.client.transaction(() => {
      this.client.prepare(`
        UPDATE openviking_session_records SET status = 'synchronized', error = NULL, updated_at = ?
        WHERE source_type = ? AND source_id = ?
      `).run(timestamp, exchange.sourceType, exchange.sourceId)
      const insert = this.client.prepare(`
        INSERT INTO persona_memories (
          id, persona_id, content, content_hash, memory_type, status,
          source_type, source_id, remote_uri, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'candidate', 'openviking_session', ?, ?, ?, ?)
        ON CONFLICT(remote_uri) DO UPDATE SET
          content = excluded.content, content_hash = excluded.content_hash,
          memory_type = excluded.memory_type, updated_at = excluded.updated_at
      `)
      for (const memory of memories) {
        insert.run(
          memory.remoteUri,
          exchange.personaId,
          memory.content,
          memory.contentHash,
          memory.memoryType,
          exchange.sourceId,
          memory.remoteUri,
          timestamp,
          timestamp,
        )
      }
    }).immediate()
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
        id, source_id, scope_type, scope_id, user_id, peer_id, provider,
        remote_uri, content_hash, status, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'openviking', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, scope_type, scope_id, provider) DO UPDATE SET
        user_id = excluded.user_id,
        peer_id = excluded.peer_id,
        remote_uri = excluded.remote_uri,
        content_hash = excluded.content_hash,
        status = excluded.status,
        error = excluded.error,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.sourceId,
      record.scopeType,
      record.scopeId,
      record.userId,
      record.peerId,
      record.remoteUri,
      record.contentHash,
      record.status,
      record.error,
      record.createdAt,
      record.updatedAt,
    )
  }

  /** @param id 同步记录 UUID。 @returns 删除完成时结束。 */
  async deleteSyncRecord(id: string): Promise<void> {
    this.client.prepare('DELETE FROM context_sync_records WHERE id = ?').run(id)
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
    scopeType: data.scope_type as ContextSyncRecordView['scopeType'],
    scopeId: String(data.scope_id),
    userId: String(data.user_id),
    peerId: data.peer_id === null ? null : String(data.peer_id),
    provider: 'openviking',
    remoteUri: data.remote_uri === null ? null : String(data.remote_uri),
    contentHash: String(data.content_hash),
    status: data.status as ContextSyncRecordView['status'],
    error: data.error === null ? null : String(data.error),
    createdAt: Number(data.created_at),
    updatedAt: Number(data.updated_at),
  }
}

/** @param value SQLite 联表行。 @returns 完整资料投影。 */
function toProjection(value: unknown): ContextSourceProjection {
  const data = row(value)
  return {
    source: {
      id: String(data.id),
      name: String(data.name),
      role: data.role as ContextSourceDocument['role'],
      contentHash: String(data.content_hash),
      contentText: String(data.content_text),
    },
    scopeType: data.scope_type as ContextSourceProjection['scopeType'],
    scopeId: String(data.scope_id),
    userId: String(data.user_id),
    peerId: data.peer_id === null ? null : String(data.peer_id),
    priority: Number(data.priority),
  }
}
