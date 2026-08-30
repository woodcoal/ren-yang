import { randomUUID } from 'node:crypto'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { ContextSyncRecordPageView, ContextSyncRecordView } from '../../../shared/types/context'
import type {
  ContextIndexRepository,
  ActiveLocalLearning,
  ContextSessionExchange,
  ContextSourceDocument,
  ContextSourceProjection,
  ContextSourceScope,
  DerivedMemoryDocument,
  PendingContextSessionSource,
  ListSyncRecordPageInput,
} from '../../ports/ContextIndexRepository'
import { insertAuditEvent } from './AuditSql'

/** 使用 SQLite 保存 OpenViking 可重建同步状态和检索范围。 */
export class SqliteContextIndexRepository implements ContextIndexRepository {
  /**
   * 创建上下文索引仓储。
   * @param client 已迁移 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @returns 全部业务世界 User，以及未关联世界人物的隐藏 User。 */
  async listTargetUserIds(): Promise<string[]> {
    return this.client.prepare(`
      SELECT user_id FROM (
        SELECT 'world-' || id AS user_id FROM worlds
        UNION
        SELECT 'standalone-' || id AS user_id FROM personas WHERE world_id IS NULL
      ) ORDER BY user_id
    `).all().map((value) => String(row(value).user_id))
  }

  /** @returns 全部 SQLite 资料完整正文。 */
  async listSourceDocuments(): Promise<ContextSourceDocument[]> {
    return this.client.prepare(`
      SELECT id, name, role, content_hash, content_text FROM source_materials
      WHERE is_enabled = 1 ORDER BY created_at, id
    `).all().map((value) => {
      const data = row(value)
      return {
        entityType: 'source_material',
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
      SELECT id, name, role, content_hash, content_text FROM source_materials
      WHERE id = ? AND is_enabled = 1
    `).get(sourceId)
    if (!value) return null
    const data = row(value)
    return {
      entityType: 'source_material',
      id: String(data.id),
      name: String(data.name),
      role: data.role as ContextSourceDocument['role'],
      contentHash: String(data.content_hash),
      contentText: String(data.content_text),
    }
  }

  /** @param entityType 可选实体类型。 @param sourceId 可选实体 UUID。 @returns 当前写入投影与待删除人物反馈投影。 */
  async listSourceProjections(entityType?: 'source_material' | 'persona_feedback_source', sourceId?: string): Promise<ContextSourceProjection[]> {
    const projections: ContextSourceProjection[] = []
    const filter = sourceId
      ? 'WHERE source_materials.id = ? AND source_materials.is_enabled = 1'
      : 'WHERE source_materials.is_enabled = 1'
    const parameters = sourceId ? [sourceId] : []
    if (!entityType || entityType === 'source_material') projections.push(...this.client.prepare(`
      SELECT source_materials.id, source_materials.name, source_materials.role,
        source_materials.content_hash, source_materials.content_text,
        'world' AS scope_type, worlds.id AS scope_id,
        'world-' || worlds.id AS user_id, NULL AS peer_id, world_sources.priority,
        'source_material' AS entity_type, 'upsert' AS operation,
        'viking://~/resources/ren-yang/world-source/' || source_materials.id || '.md' AS remote_uri
      FROM world_sources
      INNER JOIN worlds ON worlds.id = world_sources.world_id
      INNER JOIN source_materials ON source_materials.id = world_sources.source_id
      ${filter}
      UNION ALL
      SELECT source_materials.id, source_materials.name, source_materials.role,
        source_materials.content_hash, source_materials.content_text,
        'persona' AS scope_type, personas.id AS scope_id,
        CASE WHEN personas.world_id IS NULL THEN 'standalone-' || personas.id ELSE 'world-' || personas.world_id END AS user_id,
        'persona-' || personas.id AS peer_id, persona_sources.priority,
        'source_material' AS entity_type, 'upsert' AS operation,
        'viking://~/peers/persona-' || personas.id || '/resources/ren-yang/persona-source/' || source_materials.id || '.md' AS remote_uri
      FROM persona_sources
      INNER JOIN personas ON personas.id = persona_sources.persona_id
      INNER JOIN source_materials ON source_materials.id = persona_sources.source_id
      ${filter}
      ORDER BY 6, 7, 1
    `).all(...parameters, ...parameters).map(toProjection))
    if (!entityType || entityType === 'persona_feedback_source') {
      const feedbackFilter = sourceId ? 'AND persona_feedback_sources.id = ?' : ''
      projections.push(...this.client.prepare(`
        SELECT persona_feedback_sources.id, persona_feedback_sources.title AS name,
          'feedback' AS role, persona_feedback_sources.content_hash,
          persona_feedback_sources.content AS content_text,
          'persona' AS scope_type, personas.id AS scope_id,
          CASE WHEN personas.world_id IS NULL THEN 'standalone-' || personas.id ELSE 'world-' || personas.world_id END AS user_id,
          'persona-' || personas.id AS peer_id, 0 AS priority,
          'persona_feedback_source' AS entity_type,
          CASE persona_feedback_sources.deletion_state WHEN 'active' THEN 'upsert' ELSE 'delete' END AS operation,
          'viking://~/peers/persona-' || personas.id || '/resources/ren-yang/feedback-source/' || persona_feedback_sources.id || '.md' AS remote_uri
        FROM persona_feedback_sources
        INNER JOIN personas ON personas.id = persona_feedback_sources.persona_id
        WHERE persona_feedback_sources.deletion_state IN ('active', 'pending_remote_delete') ${feedbackFilter}
        ORDER BY personas.id, persona_feedback_sources.id
      `).all(...(sourceId ? [sourceId] : [])).map(toProjection))
    }
    return projections.sort((left, right) => `${left.scopeType}:${left.scopeId}:${left.source.entityType}:${left.source.id}`.localeCompare(`${right.scopeType}:${right.scopeId}:${right.source.entityType}:${right.source.id}`))
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
      WHERE source_materials.is_enabled = 1
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
        AND context_sync_records.entity_type = 'source_material'
        AND context_sync_records.operation = 'upsert'
        AND context_sync_records.status = 'synchronized'
        AND source_materials.is_enabled = 1
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
    return { userId, peerId, targets: sourceTargets }
  }

  /** @param personaId 人物 UUID。 @returns 没有远端 URI但必须参与提示的有效成长和记忆。 */
  async listActiveLocalLearning(personaId: string): Promise<ActiveLocalLearning[]> {
    return this.client.prepare(`
      SELECT memory_records.id, 'persona_memory' AS entity_type, 'memory' AS role,
        memory_revisions.content, memory_revisions.content_hash, memory_revisions.importance, memory_records.updated_at
      FROM memory_records
      INNER JOIN memory_revisions ON memory_revisions.id = memory_records.current_revision_id
      WHERE memory_records.persona_id = ? AND memory_records.status = 'active'
      UNION ALL
      SELECT growth_records.id, 'persona_growth' AS entity_type, 'growth' AS role,
        growth_revisions.content, growth_revisions.content_hash, growth_revisions.importance, growth_records.updated_at
      FROM growth_records
      INNER JOIN growth_revisions ON growth_revisions.id = growth_records.current_revision_id
      WHERE growth_records.persona_id = ? AND growth_records.status = 'active'
      UNION ALL
      SELECT growth_records.id, 'world_growth' AS entity_type, 'growth' AS role,
        growth_revisions.content, growth_revisions.content_hash, growth_revisions.importance, growth_records.updated_at
      FROM personas
      INNER JOIN growth_records ON growth_records.world_id = personas.world_id
      INNER JOIN growth_revisions ON growth_revisions.id = growth_records.current_revision_id
      WHERE personas.id = ? AND growth_records.status = 'active'
      ORDER BY importance DESC, updated_at DESC, id
    `).all(personaId, personaId, personaId).map((value) => {
      const data = row(value)
      return {
        id: String(data.id),
        entityType: data.entity_type as ActiveLocalLearning['entityType'],
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
            persona_operation_records.result_summary,
            GROUP_CONCAT(block_attempts.output_text, '\n\n') AS block_output
          FROM generation_runs
          INNER JOIN persona_operation_records ON persona_operation_records.run_id = generation_runs.id
          INNER JOIN soul_versions ON soul_versions.id = generation_runs.persona_version_id
          INNER JOIN personas ON personas.id = soul_versions.persona_id
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
          INNER JOIN soul_versions ON soul_versions.id = generation_runs.persona_version_id
          INNER JOIN personas ON personas.id = soul_versions.persona_id
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
      ? String(data.block_output ?? data.result_json ?? data.result_summary)
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
      extractMemory: true,
    }
  }

  /** @returns 没有成功同步状态的终态运行和反馈，用于进程重启后补回丢失任务。 */
  async listPendingSessionSources(): Promise<PendingContextSessionSource[]> {
    return this.client.prepare(`
      SELECT 'run' AS source_type, persona_operation_records.run_id AS source_id
      FROM persona_operation_records
      WHERE persona_operation_records.is_enabled = 1
        AND NOT EXISTS (
          SELECT 1 FROM openviking_session_records
          WHERE source_type = 'run' AND source_id = persona_operation_records.run_id AND status = 'synchronized'
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

  /** @param timestamp 重建开始时间。 @returns 全部已知 Session 投影改为待重放后结束。 */
  async markSessionsForRebuild(timestamp: number): Promise<void> {
    this.client.prepare(`
      UPDATE openviking_session_records
      SET status = 'pending', error = NULL, updated_at = ?
    `).run(timestamp)
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
      if (exchange.sourceType === 'run') {
        this.client.prepare(`
          UPDATE persona_operation_records SET session_record_id = ?, updated_at = ? WHERE run_id = ?
        `).run(exchange.sessionId, timestamp, exchange.sourceId)
      }
      const insert = this.client.prepare(`
        INSERT INTO openviking_derived_memories (
          id, persona_id, source_session_record_id, user_id, peer_id, remote_uri,
          memory_type, content, content_hash, is_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(user_id, peer_id, remote_uri) DO UPDATE SET
          persona_id = excluded.persona_id,
          source_session_record_id = excluded.source_session_record_id,
          content = excluded.content, content_hash = excluded.content_hash,
          memory_type = excluded.memory_type, is_enabled = 1, updated_at = excluded.updated_at
      `)
      for (const memory of memories) {
        insert.run(
          randomUUID(),
          exchange.personaId,
          exchange.sessionId,
          exchange.userId,
          exchange.peerId,
          memory.remoteUri,
          memory.memoryType,
          memory.content,
          memory.contentHash,
          timestamp,
          timestamp,
        )
      }
    }).immediate()
  }

  /** @param sourceId 已完成远端删除的人物反馈资料 UUID。 @param timestamp 完成时间。 @returns 本地敏感正文和活动行清理完成时结束。 */
  async finalizePersonaFeedbackSourceDeletion(sourceId: string, timestamp: number): Promise<void> {
    this.client.transaction(() => {
      const source = this.client.prepare(`
        SELECT id FROM persona_feedback_sources WHERE id = ? AND deletion_state = 'pending_remote_delete'
      `).get(sourceId)
      if (!source) return
      this.client.prepare(`
        UPDATE growth_revision_evidence SET source_available = 0
        WHERE source_type = 'persona_feedback_source' AND source_id = ?
      `).run(sourceId)
      this.client.prepare(`
        UPDATE analysis_batch_inputs SET content_snapshot = NULL, source_available = 0
        WHERE input_type = 'persona_feedback_source' AND input_id = ?
      `).run(sourceId)
      this.client.prepare(`DELETE FROM persona_feedback_sources WHERE id = ?`).run(sourceId)
      insertAuditEvent(this.client, {
        actor: 'system', action: 'persona_feedback_source_deleted',
        targetType: 'persona_feedback_source', targetId: sourceId, timestamp,
      })
    }).immediate()
  }

  /** @returns 全部 OpenViking 同步记录。 */
  async listSyncRecords(): Promise<ContextSyncRecordView[]> {
    return this.client.prepare(`SELECT * FROM context_sync_records ORDER BY updated_at DESC, source_id`).all()
      .map(toSyncRecord)
  }

  /** @param input 分页参数。 @returns 最近更新在前的同步日志分页结果。 */
  async listSyncRecordsPage(input: ListSyncRecordPageInput): Promise<ContextSyncRecordPageView> {
    const total = Number((this.client.prepare('SELECT COUNT(*) AS count FROM context_sync_records').get() as { count: number }).count)
    const totalPages = Math.max(1, Math.ceil(total / input.pageSize))
    const page = Math.min(input.page, totalPages)
    const items = this.client.prepare(`
      SELECT * FROM context_sync_records
      ORDER BY updated_at DESC, source_id, id LIMIT ? OFFSET ?
    `).all(input.pageSize, (page - 1) * input.pageSize).map(toSyncRecord)
    return { items, total, page, pageSize: input.pageSize, totalPages }
  }

  /** @returns 当前同步失败记录数。 */
  async countFailedSyncRecords(): Promise<number> {
    return Number((this.client.prepare(`
      SELECT COUNT(*) AS count FROM context_sync_records WHERE status = 'failed'
    `).get() as { count: number }).count)
  }

  /** @param record 完整同步事实。 @returns 无返回值。 */
  async saveSyncRecord(record: ContextSyncRecordView): Promise<void> {
    this.client.prepare(`
      INSERT INTO context_sync_records (
        id, entity_type, source_id, scope_type, scope_id, user_id, peer_id, provider,
        remote_uri, content_hash, status, operation, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'openviking', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, source_id, scope_type, scope_id, provider) DO UPDATE SET
        user_id = excluded.user_id,
        peer_id = excluded.peer_id,
        remote_uri = excluded.remote_uri,
        content_hash = excluded.content_hash,
        status = excluded.status,
        operation = excluded.operation,
        error = excluded.error,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.entityType,
      record.sourceId,
      record.scopeType,
      record.scopeId,
      record.userId,
      record.peerId,
      record.remoteUri,
      record.contentHash,
      record.status,
      record.operation,
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
    entityType: data.entity_type as ContextSyncRecordView['entityType'],
    sourceId: String(data.source_id),
    scopeType: data.scope_type as ContextSyncRecordView['scopeType'],
    scopeId: String(data.scope_id),
    userId: String(data.user_id),
    peerId: data.peer_id === null ? null : String(data.peer_id),
    provider: 'openviking',
    remoteUri: data.remote_uri === null ? null : String(data.remote_uri),
    contentHash: String(data.content_hash),
    status: data.status as ContextSyncRecordView['status'],
    operation: data.operation as ContextSyncRecordView['operation'],
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
      entityType: data.entity_type as ContextSourceDocument['entityType'],
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
    operation: data.operation as ContextSourceProjection['operation'],
    remoteUri: String(data.remote_uri),
  }
}
