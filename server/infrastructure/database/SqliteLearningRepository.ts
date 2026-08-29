import { createHash, randomUUID } from 'node:crypto'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type {
  GrowthRecordView,
  MemoryRecordView,
  PersonaFeedbackSourceView,
  PersonaOperationRecordView,
  WorldGrowthSourceView,
} from '../../../shared/types/learning'
import type {
  CreateGrowthRecord,
  CreatePersonaOperationRecord,
  CreatePersonaFeedbackSourceRecord,
  LearningRepository,
} from '../../ports/LearningRepository'
import { insertAuditEvent } from './AuditSql'

/** 使用 SQLite 短事务保存成长原始资料、成长、处理记录和记忆事实。 */
export class SqliteLearningRepository implements LearningRepository {
  /**
   * 创建统一学习事实仓储。
   * @param client 已启用外键的 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @param worldId 世界 UUID。 @returns 世界资料及成长启用状态。 */
  async listWorldGrowthSources(worldId: string): Promise<WorldGrowthSourceView[]> {
    return this.client.prepare(`
      SELECT source_materials.id, source_materials.name, source_materials.content_text,
        world_sources.is_enabled, world_sources.updated_at
      FROM world_sources
      INNER JOIN source_materials ON source_materials.id = world_sources.source_id
      WHERE world_sources.world_id = ?
      ORDER BY world_sources.priority, source_materials.name, source_materials.id
    `).all(worldId).map(toWorldGrowthSource)
  }

  /** @param worldId 世界 UUID。 @param ids 资料 UUID。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 已核对并更新的条目数。 */
  async updateWorldGrowthSourceStates(worldId: string, ids: string[], isEnabled: boolean, timestamp: number): Promise<number> {
    return this.updateScopedEnabledState({
      table: 'world_sources', scopeColumn: 'world_id', idColumn: 'source_id', scopeId: worldId,
      ids, isEnabled, timestamp,
    })
  }

  /** @param personaId 人物 UUID。 @returns 人物反馈资料。 */
  async listPersonaFeedbackSources(personaId: string): Promise<PersonaFeedbackSourceView[]> {
    return this.client.prepare(`
      SELECT * FROM persona_feedback_sources WHERE persona_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(personaId).map(toPersonaFeedbackSource)
  }

  /** @param record 创建命令。 @returns 无返回值。 */
  async createPersonaFeedbackSource(record: CreatePersonaFeedbackSourceRecord): Promise<void> {
    const contentHash = hashContent(record.content)
    this.client.transaction(() => {
      this.client.prepare(`
        INSERT INTO persona_feedback_sources (
          id, persona_id, title, content, source_type, source_id, is_enabled,
          content_hash, deletion_state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'active', ?, ?)
      `).run(
        record.id, record.personaId, record.title, record.content, record.sourceType,
        record.sourceId, contentHash, record.timestamp, record.timestamp,
      )
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'persona_feedback_source_created',
        targetType: 'persona_feedback_source', targetId: record.id, timestamp: record.timestamp,
      })
    })()
  }

  /** @param personaId 人物 UUID。 @param ids 反馈资料 UUID。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 已核对并更新的条目数。 */
  async updatePersonaFeedbackSourceStates(personaId: string, ids: string[], isEnabled: boolean, timestamp: number): Promise<number> {
    return this.updateScopedEnabledState({
      table: 'persona_feedback_sources', scopeColumn: 'persona_id', idColumn: 'id', scopeId: personaId,
      ids, isEnabled, timestamp, extraWhere: `deletion_state = 'active'`,
    })
  }

  /** @param personaId 人物 UUID。 @param ids 反馈资料 UUID。 @param timestamp 删除时间。 @returns 物理删除数量。 */
  async deletePersonaFeedbackSources(personaId: string, ids: string[], timestamp: number): Promise<number> {
    return this.client.transaction(() => {
      const placeholders = createPlaceholders(ids)
      const rows = this.client.prepare(`
        SELECT id FROM persona_feedback_sources
        WHERE persona_id = ? AND deletion_state = 'active' AND id IN (${placeholders})
      `).all(personaId, ...ids) as Array<{ id: string }>
      if (rows.length !== ids.length) return 0
      this.client.prepare(`
        UPDATE growth_revision_evidence SET source_available = 0
        WHERE source_type = 'persona_feedback_source' AND source_id IN (${placeholders})
      `).run(...ids)
      const changes = this.client.prepare(`
        DELETE FROM persona_feedback_sources WHERE persona_id = ? AND id IN (${placeholders})
      `).run(personaId, ...ids).changes
      for (const id of ids) {
        insertAuditEvent(this.client, {
          actor: 'administrator', action: 'persona_feedback_source_deleted',
          targetType: 'persona_feedback_source', targetId: id, timestamp,
        })
      }
      return changes
    }).immediate()
  }

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @returns 当前成长修订。 */
  async listGrowth(subjectType: 'world' | 'persona', subjectId: string): Promise<GrowthRecordView[]> {
    const scopeColumn = subjectType === 'world' ? 'world_id' : 'persona_id'
    return this.client.prepare(`
      SELECT growth_records.*, growth_revisions.id AS revision_id, growth_revisions.revision_no,
        growth_revisions.content, growth_revisions.scope, growth_revisions.importance,
        growth_revisions.conflict_summary,
        (SELECT COUNT(*) FROM growth_revision_evidence
          WHERE growth_revision_evidence.growth_revision_id = growth_revisions.id) AS evidence_count
      FROM growth_records
      INNER JOIN growth_revisions ON growth_revisions.id = growth_records.current_revision_id
      WHERE growth_records.subject_type = ? AND growth_records.${scopeColumn} = ?
      ORDER BY growth_records.updated_at DESC, growth_records.id DESC
    `).all(subjectType, subjectId).map(toGrowth)
  }

  /** @param record 创建命令。 @returns 无返回值。 */
  async createGrowth(record: CreateGrowthRecord): Promise<void> {
    this.client.transaction(() => {
      const worldId = record.subjectType === 'world' ? record.subjectId : null
      const personaId = record.subjectType === 'persona' ? record.subjectId : null
      this.client.prepare(`
        INSERT INTO growth_records (
          id, subject_type, world_id, persona_id, current_revision_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'candidate', ?, ?)
      `).run(record.id, record.subjectType, worldId, personaId, record.revisionId, record.timestamp, record.timestamp)
      this.client.prepare(`
        INSERT INTO growth_revisions (
          id, growth_id, revision_no, content, content_hash, scope, importance,
          conflict_summary, analysis_batch_id, created_by, created_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, NULL, NULL, 'user', ?)
      `).run(
        record.revisionId, record.id, record.content, hashContent(record.content),
        record.scope, record.importance, record.timestamp,
      )
      this.insertGrowthEvidence(record)
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'growth_candidate_created',
        targetType: 'growth', targetId: record.id, timestamp: record.timestamp,
      })
    }).immediate()
  }

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param ids 成长 UUID。 @param status 目标状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  async updateGrowthStates(subjectType: 'world' | 'persona', subjectId: string, ids: string[], status: 'active' | 'archived' | 'rejected', timestamp: number): Promise<number> {
    const scopeColumn = subjectType === 'world' ? 'world_id' : 'persona_id'
    return this.updateLearningStates({
      table: 'growth_records', scopeColumn, scopeId: subjectId, ids, status, timestamp,
      extraWhere: `subject_type = '${subjectType}'`,
    })
  }

  /** @param personaId 人物 UUID。 @returns 人物处理记录。 */
  async listPersonaOperationRecords(personaId: string): Promise<PersonaOperationRecordView[]> {
    return this.client.prepare(`
      SELECT * FROM persona_operation_records WHERE persona_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(personaId).map(toOperationRecord)
  }

  /** @param record 创建命令。 @returns 首次创建时为 true，运行已有记录时为 false。 */
  async createPersonaOperationRecord(record: CreatePersonaOperationRecord): Promise<boolean> {
    return this.client.prepare(`
      INSERT OR IGNORE INTO persona_operation_records (
        id, persona_id, run_id, operation_type, result_summary, decision_json,
        is_enabled, context_snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      record.id, record.personaId, record.runId, record.operationType, record.resultSummary,
      record.decision ? JSON.stringify(record.decision) : null, JSON.stringify(record.contextSnapshot),
      record.timestamp, record.timestamp,
    ).changes === 1
  }

  /** @param personaId 人物 UUID。 @param ids 处理记录 UUID。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 已核对并更新的条目数。 */
  async updatePersonaOperationRecordStates(personaId: string, ids: string[], isEnabled: boolean, timestamp: number): Promise<number> {
    return this.updateScopedEnabledState({
      table: 'persona_operation_records', scopeColumn: 'persona_id', idColumn: 'id', scopeId: personaId,
      ids, isEnabled, timestamp,
    })
  }

  /** @param personaId 人物 UUID。 @returns 人物当前记忆修订。 */
  async listMemories(personaId: string): Promise<MemoryRecordView[]> {
    return this.client.prepare(`
      SELECT memory_records.*, memory_revisions.id AS revision_id, memory_revisions.revision_no,
        memory_revisions.content, memory_revisions.scope, memory_revisions.importance,
        memory_revisions.independent_evidence_count, memory_revisions.conflict_summary
      FROM memory_records
      INNER JOIN memory_revisions ON memory_revisions.id = memory_records.current_revision_id
      WHERE memory_records.persona_id = ?
      ORDER BY memory_records.updated_at DESC, memory_records.id DESC
    `).all(personaId).map(toMemory)
  }

  /** @param personaId 人物 UUID。 @param ids 记忆 UUID。 @param status 目标状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  async updateMemoryStates(personaId: string, ids: string[], status: 'active' | 'archived' | 'rejected', timestamp: number): Promise<number> {
    return this.updateLearningStates({
      table: 'memory_records', scopeColumn: 'persona_id', scopeId: personaId, ids, status, timestamp,
    })
  }

  /** @param personaId 人物 UUID。 @param memoryId 记忆 UUID。 @param feedbackId 新反馈 UUID。 @param timestamp 创建时间。 @returns 新反馈资料或 null。 */
  async convertMemoryToFeedbackSource(personaId: string, memoryId: string, feedbackId: string, timestamp: number): Promise<PersonaFeedbackSourceView | null> {
    const created = this.client.transaction(() => {
      const row = this.client.prepare(`
        SELECT memory_revisions.content FROM memory_records
        INNER JOIN memory_revisions ON memory_revisions.id = memory_records.current_revision_id
        WHERE memory_records.id = ? AND memory_records.persona_id = ?
      `).get(memoryId, personaId) as { content: string } | undefined
      if (!row) return false
      this.client.prepare(`
        INSERT INTO persona_feedback_sources (
          id, persona_id, title, content, source_type, source_id, is_enabled,
          content_hash, deletion_state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'memory_conversion', ?, 1, ?, 'active', ?, ?)
      `).run(feedbackId, personaId, '由记忆转入的成长资料', row.content, memoryId, hashContent(row.content), timestamp, timestamp)
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'memory_converted_to_feedback_source',
        targetType: 'memory', targetId: memoryId, timestamp,
      })
      return true
    }).immediate()
    if (!created) return null
    return (await this.listPersonaFeedbackSources(personaId)).find(item => item.id === feedbackId) ?? null
  }

  /**
   * 核对所选条目全部属于当前对象后原子更新启用状态。
   * @param input 受控表名、范围列、标识列、对象和目标状态。
   * @returns 全部条目更新时返回所选数量，否则返回零。
   */
  private updateScopedEnabledState(input: {
    table: 'world_sources' | 'persona_feedback_sources' | 'persona_operation_records'
    scopeColumn: 'world_id' | 'persona_id'
    idColumn: 'source_id' | 'id'
    scopeId: string
    ids: string[]
    isEnabled: boolean
    timestamp: number
    extraWhere?: string
  }): number {
    return this.client.transaction(() => {
      const placeholders = createPlaceholders(input.ids)
      const extraWhere = input.extraWhere ? ` AND ${input.extraWhere}` : ''
      const row = this.client.prepare(`
        SELECT COUNT(*) AS count FROM ${input.table}
        WHERE ${input.scopeColumn} = ? AND ${input.idColumn} IN (${placeholders})${extraWhere}
      `).get(input.scopeId, ...input.ids) as { count: number }
      if (Number(row.count) !== input.ids.length) return 0
      if (input.table === 'world_sources') {
        this.client.prepare(`
          UPDATE world_sources
          SET is_enabled = ?, enabled_at = CASE WHEN ? = 1 THEN ? ELSE enabled_at END,
            disabled_at = CASE WHEN ? = 0 THEN ? ELSE disabled_at END, updated_at = ?
          WHERE world_id = ? AND source_id IN (${placeholders})${extraWhere}
        `).run(
          input.isEnabled ? 1 : 0, input.isEnabled ? 1 : 0, input.timestamp,
          input.isEnabled ? 1 : 0, input.timestamp, input.timestamp, input.scopeId, ...input.ids,
        )
      }
      else {
        this.client.prepare(`
          UPDATE ${input.table} SET is_enabled = ?, updated_at = ?
          WHERE ${input.scopeColumn} = ? AND ${input.idColumn} IN (${placeholders})${extraWhere}
        `).run(input.isEnabled ? 1 : 0, input.timestamp, input.scopeId, ...input.ids)
      }
      return input.ids.length
    }).immediate()
  }

  /**
   * 按统一状态机核对并更新成长或记忆状态。
   * @param input 受控表名、对象范围、所选标识和目标状态。
   * @returns 全部状态合法时返回所选数量，否则返回零。
   */
  private updateLearningStates(input: {
    table: 'growth_records' | 'memory_records'
    scopeColumn: 'world_id' | 'persona_id'
    scopeId: string
    ids: string[]
    status: 'active' | 'archived' | 'rejected'
    timestamp: number
    extraWhere?: string
  }): number {
    const allowed = allowedSourceStatuses(input.status)
    return this.client.transaction(() => {
      const placeholders = createPlaceholders(input.ids)
      const statusPlaceholders = createPlaceholders(allowed)
      const extraWhere = input.extraWhere ? ` AND ${input.extraWhere}` : ''
      const row = this.client.prepare(`
        SELECT COUNT(*) AS count FROM ${input.table}
        WHERE ${input.scopeColumn} = ? AND id IN (${placeholders})
          AND status IN (${statusPlaceholders})${extraWhere}
      `).get(input.scopeId, ...input.ids, ...allowed) as { count: number }
      if (Number(row.count) !== input.ids.length) return 0
      this.client.prepare(`
        UPDATE ${input.table} SET status = ?, updated_at = ?
        WHERE ${input.scopeColumn} = ? AND id IN (${placeholders})${extraWhere}
      `).run(input.status, input.timestamp, input.scopeId, ...input.ids)
      return input.ids.length
    }).immediate()
  }

  /**
   * 将已核对的原始资料快照写入第一版成长证据链。
   * @param record 成长创建命令。
   * @returns 无返回值。
   */
  private insertGrowthEvidence(record: CreateGrowthRecord): void {
    if (record.sourceIds.length === 0) return
    const sourceType = record.subjectType === 'world' ? 'world_source' : 'persona_feedback_source'
    const placeholders = createPlaceholders(record.sourceIds)
    const rows = record.subjectType === 'world'
      ? this.client.prepare(`
          SELECT source_materials.id, source_materials.name AS title, source_materials.content_hash AS hash
          FROM world_sources INNER JOIN source_materials ON source_materials.id = world_sources.source_id
          WHERE world_sources.world_id = ? AND world_sources.source_id IN (${placeholders})
        `).all(record.subjectId, ...record.sourceIds)
      : this.client.prepare(`
          SELECT id, title, content_hash AS hash FROM persona_feedback_sources
          WHERE persona_id = ? AND deletion_state = 'active' AND id IN (${placeholders})
        `).all(record.subjectId, ...record.sourceIds)
    if (rows.length !== record.sourceIds.length) throw new Error('成长来源不属于当前对象')
    const insert = this.client.prepare(`
      INSERT INTO growth_revision_evidence (
        id, growth_revision_id, source_type, source_id, source_hash,
        source_title, relationship, source_available
      ) VALUES (?, ?, ?, ?, ?, ?, 'supporting', 1)
    `)
    for (const value of rows as Array<Record<string, unknown>>) {
      insert.run(randomUUID(), record.revisionId, sourceType, String(value.id), String(value.hash), String(value.title))
    }
  }
}

/** @param value SQLite 行。 @returns 世界资料成长视图。 */
function toWorldGrowthSource(value: unknown): WorldGrowthSourceView {
  const row = value as Record<string, unknown>
  const content = String(row.content_text)
  return {
    id: String(row.id), name: String(row.name), summary: content.slice(0, 240),
    isEnabled: Number(row.is_enabled) === 1, updatedAt: Number(row.updated_at),
  }
}

/** @param value SQLite 行。 @returns 人物反馈资料视图。 */
function toPersonaFeedbackSource(value: unknown): PersonaFeedbackSourceView {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id), personaId: String(row.persona_id), title: String(row.title), content: String(row.content),
    sourceType: row.source_type as PersonaFeedbackSourceView['sourceType'],
    sourceId: row.source_id === null ? null : String(row.source_id), isEnabled: Number(row.is_enabled) === 1,
    contentHash: String(row.content_hash), deletionState: row.deletion_state as PersonaFeedbackSourceView['deletionState'],
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

/** @param value SQLite 行。 @returns 成长当前修订视图。 */
function toGrowth(value: unknown): GrowthRecordView {
  const row = value as Record<string, unknown>
  const subjectType = row.subject_type as 'world' | 'persona'
  return {
    id: String(row.id), subjectType,
    subjectId: String(subjectType === 'world' ? row.world_id : row.persona_id),
    status: row.status as GrowthRecordView['status'], revisionId: String(row.revision_id),
    revisionNo: Number(row.revision_no), content: String(row.content), scope: String(row.scope),
    importance: Number(row.importance), conflictSummary: row.conflict_summary === null ? null : String(row.conflict_summary),
    evidenceCount: Number(row.evidence_count), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

/** @param value SQLite 行。 @returns 人物处理记录视图。 */
function toOperationRecord(value: unknown): PersonaOperationRecordView {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id), personaId: String(row.persona_id), runId: String(row.run_id),
    operationType: row.operation_type as PersonaOperationRecordView['operationType'],
    resultSummary: String(row.result_summary), isEnabled: Number(row.is_enabled) === 1,
    sessionRecordId: row.session_record_id === null ? null : String(row.session_record_id),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

/** @param value SQLite 行。 @returns 人物记忆当前修订视图。 */
function toMemory(value: unknown): MemoryRecordView {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id), personaId: String(row.persona_id), memoryType: row.memory_type as MemoryRecordView['memoryType'],
    status: row.status as MemoryRecordView['status'], revisionId: String(row.revision_id), revisionNo: Number(row.revision_no),
    content: String(row.content), scope: String(row.scope), importance: Number(row.importance),
    independentEvidenceCount: Number(row.independent_evidence_count),
    conflictSummary: row.conflict_summary === null ? null : String(row.conflict_summary),
    openVikingUri: row.openviking_uri === null ? null : String(row.openviking_uri),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

/** @param status 目标状态。 @returns 允许转换到该状态的原状态。 */
function allowedSourceStatuses(status: 'active' | 'archived' | 'rejected'): string[] {
  if (status === 'active') return ['candidate', 'archived', 'active']
  if (status === 'archived') return ['active', 'archived']
  return ['candidate', 'rejected']
}

/** @param values 参数数量来源。 @returns 参数化 IN 子句占位符。 */
function createPlaceholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ')
}

/** @param content 规范化正文。 @returns SHA-256 十六进制哈希。 */
function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}
