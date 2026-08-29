import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { soulSnapshotSchema } from '../../../shared/schemas/content'
import type {
  PersonaRecord,
  PersonaVersionRecord,
  SoulDraftRecord,
  SoulSubjectType,
  SoulVersionRecord,
  SourceChunkRecord,
  SourceMaterialRecord,
  WorldRecord,
  WorldVersionRecord,
} from '../../domain/content/ContentModels'
import type {
  ContentRepository,
  CreatePersonaRecord,
  CreateSourceRecord,
  CreateWorldRecord,
  PersonaRunHistoryStatistics,
  SourceLinkRecord,
  WorldVersionDeletionReferences,
} from '../../ports/ContentRepository'
import type { PublishSoulDraftRecord, SoulRepository } from '../../ports/SoulRepository'
import { insertAuditEvent } from './AuditSql'

/** 使用 SQLite 短事务实现人物、世界、版本、资料和 FTS5 数据访问。 */
export class SqliteContentRepository implements ContentRepository, SoulRepository {
  /**
   * 创建内容仓储。
   * @param client 已启用外键和迁移的 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @returns 按更新时间倒序的人物记录。 */
  async listPersonas(): Promise<PersonaRecord[]> {
    return this.client.prepare('SELECT * FROM personas ORDER BY updated_at DESC, id').all().map(toPersona)
  }

  /** @param id 人物 UUID。 @returns 找到的人物或 null。 */
  async findPersona(id: string): Promise<PersonaRecord | null> {
    const row = this.client.prepare('SELECT * FROM personas WHERE id = ?').get(id)
    return row ? toPersona(row) : null
  }

  /**
   * 原子创建人物、初始灵魂草稿和资料关联。
   * @param record 已验证的创建命令。
   * @returns 无返回值。
   */
  async createPersona(record: CreatePersonaRecord): Promise<void> {
    this.client.transaction(() => {
      this.client.prepare(`
        INSERT INTO personas (id, world_id, name, origin, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(record.id, record.worldId, record.name, record.origin, record.timestamp, record.timestamp)
      this.client.prepare(`
        INSERT INTO soul_drafts (
          id, subject_type, persona_id, base_version_id, chapters_json, runtime_summary,
          change_summary, created_at, updated_at
        ) VALUES (?, 'persona', ?, NULL, ?, ?, ?, ?, ?)
      `).run(
        record.draftId,
        record.id,
        JSON.stringify(record.snapshot.chapters),
        record.snapshot.runtimeSummary,
        record.changeSummary,
        record.timestamp,
        record.timestamp,
      )
      const link = this.client.prepare(`
        INSERT INTO persona_sources (persona_id, source_id, priority) VALUES (?, ?, 100)
      `)
      for (const sourceId of record.sourceIds) {
        link.run(record.id, sourceId)
      }
    })()
  }

  /** @param id 人物 UUID。 @param name 新名称。 @param worldId 新世界 UUID 或 null。 @param timestamp 更新时间。 @returns 是否更新。 */
  async updatePersona(id: string, name: string, worldId: string | null, timestamp: number): Promise<boolean> {
    return this.client.prepare(`
      UPDATE personas SET name = ?, world_id = ?, updated_at = ? WHERE id = ?
    `).run(name, worldId, timestamp, id).changes === 1
  }

  /** @param personaId 人物 UUID。 @returns 新版本在前的版本记录。 */
  async listPersonaVersions(personaId: string): Promise<PersonaVersionRecord[]> {
    return this.client.prepare(`
      SELECT * FROM soul_versions
      WHERE subject_type = 'persona' AND persona_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(personaId).map(toPersonaVersion)
  }

  /** @param id 版本 UUID。 @returns 找到的版本或 null。 */
  async findPersonaVersion(id: string): Promise<PersonaVersionRecord | null> {
    const row = this.client.prepare(`
      SELECT * FROM soul_versions WHERE id = ? AND subject_type = 'persona'
    `).get(id)
    return row ? toPersonaVersion(row) : null
  }

  /** @param personaId 人物 UUID。 @returns 关联资料。 */
  async listPersonaSources(personaId: string): Promise<SourceMaterialRecord[]> {
    return this.client.prepare(`
      SELECT source_materials.* FROM source_materials
      INNER JOIN persona_sources ON persona_sources.source_id = source_materials.id
      WHERE persona_sources.persona_id = ?
      ORDER BY persona_sources.priority, source_materials.name
    `).all(personaId).map(toSource)
  }

  /** @param personaId 人物 UUID。 @returns 将随人物删除的运行、任务、快照和产物统计。 */
  async getPersonaRunHistoryStatistics(personaId: string): Promise<PersonaRunHistoryStatistics> {
    const value = this.client.prepare(`
      WITH persona_runs AS (
        SELECT generation_runs.id FROM generation_runs
        INNER JOIN soul_versions ON soul_versions.id = generation_runs.persona_version_id
        WHERE soul_versions.persona_id = ?
      ), persona_documents AS (
        SELECT artifact_documents.id FROM artifact_documents
        INNER JOIN persona_runs ON persona_runs.id = artifact_documents.run_id
      ), persona_blocks AS (
        SELECT artifact_blocks.id FROM artifact_blocks
        INNER JOIN persona_documents ON persona_documents.id = artifact_blocks.document_id
      )
      SELECT
        (SELECT COUNT(*) FROM persona_runs) AS runs,
        (SELECT COUNT(*) FROM task_jobs INNER JOIN persona_runs ON persona_runs.id = task_jobs.run_id) AS tasks,
        (SELECT COUNT(*) FROM evidence_snapshots INNER JOIN persona_runs ON persona_runs.id = evidence_snapshots.run_id) AS evidence_snapshots,
        (SELECT COUNT(*) FROM document_specs INNER JOIN persona_runs ON persona_runs.id = document_specs.run_id) AS document_specs,
        (SELECT COUNT(*) FROM persona_blocks) AS artifact_blocks,
        (SELECT COUNT(*) FROM block_attempts INNER JOIN persona_blocks ON persona_blocks.id = block_attempts.block_id) AS block_attempts
    `).get(personaId) as Record<string, number>
    return {
      runs: Number(value.runs),
      tasks: Number(value.tasks),
      evidenceSnapshots: Number(value.evidence_snapshots),
      documentSpecs: Number(value.document_specs),
      artifactBlocks: Number(value.artifact_blocks),
      blockAttempts: Number(value.block_attempts),
    }
  }

  /** @param personaId 人物 UUID。 @returns 所属运行 UUID 列表。 */
  async listPersonaRunIds(personaId: string): Promise<string[]> {
    return (this.client.prepare(`
      SELECT generation_runs.id FROM generation_runs
      INNER JOIN soul_versions ON soul_versions.id = generation_runs.persona_version_id
      WHERE soul_versions.persona_id = ? ORDER BY generation_runs.created_at, generation_runs.id
    `).all(personaId) as Array<{ id: string }>).map(item => item.id)
  }

  /** @param personaId 人物 UUID。 @param timestamp 删除时间。 @returns 删除的人物行数；运行和私有产物先在同一事务中删除。 */
  async deletePersona(personaId: string, timestamp: number): Promise<number> {
    return this.client.transaction(() => {
      this.client.prepare(`
        DELETE FROM artifact_documents WHERE run_id IN (
          SELECT generation_runs.id FROM generation_runs
          INNER JOIN soul_versions ON soul_versions.id = generation_runs.persona_version_id
          WHERE soul_versions.persona_id = ?
        )
      `).run(personaId)
      this.client.prepare(`
        DELETE FROM generation_runs WHERE persona_version_id IN (
          SELECT id FROM soul_versions WHERE subject_type = 'persona' AND persona_id = ?
        )
      `).run(personaId)
      const changes = this.client.prepare('DELETE FROM personas WHERE id = ?').run(personaId).changes
      if (changes === 1) insertAuditEvent(this.client, {
        actor: 'administrator', action: 'persona_deleted', targetType: 'persona', targetId: personaId, timestamp,
      })
      return changes
    }).immediate()
  }

  /** @returns 按更新时间倒序的世界记录。 */
  async listWorlds(): Promise<WorldRecord[]> {
    return this.client.prepare('SELECT * FROM worlds ORDER BY updated_at DESC, id').all().map(toWorld)
  }

  /** @param id 世界 UUID。 @returns 找到的世界或 null。 */
  async findWorld(id: string): Promise<WorldRecord | null> {
    const row = this.client.prepare('SELECT * FROM worlds WHERE id = ?').get(id)
    return row ? toWorld(row) : null
  }

  /**
   * 原子创建世界和初始灵魂草稿。
   * @param record 已验证的创建命令。
   * @returns 无返回值。
   */
  async createWorld(record: CreateWorldRecord): Promise<void> {
    this.client.transaction(() => {
      this.client.prepare(`
        INSERT INTO worlds (id, name, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      `).run(record.id, record.name, record.summary, record.timestamp, record.timestamp)
      this.client.prepare(`
        INSERT INTO soul_drafts (
          id, subject_type, world_id, base_version_id, chapters_json, runtime_summary,
          change_summary, created_at, updated_at
        ) VALUES (?, 'world', ?, NULL, ?, ?, ?, ?, ?)
      `).run(
        record.draftId,
        record.id,
        JSON.stringify(record.snapshot.chapters),
        record.snapshot.runtimeSummary,
        record.changeSummary,
        record.timestamp,
        record.timestamp,
      )
    })()
  }

  /** @param id 世界 UUID。 @param name 新名称。 @param summary 新摘要。 @param timestamp 更新时间。 @returns 是否更新。 */
  async updateWorld(id: string, name: string, summary: string, timestamp: number): Promise<boolean> {
    return this.client.prepare(`
      UPDATE worlds SET name = ?, summary = ?, updated_at = ? WHERE id = ?
    `).run(name, summary, timestamp, id).changes === 1
  }

  /** @param worldId 世界 UUID。 @returns 新版本在前的版本记录。 */
  async listWorldVersions(worldId: string): Promise<WorldVersionRecord[]> {
    return this.client.prepare(`
      SELECT * FROM soul_versions
      WHERE subject_type = 'world' AND world_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(worldId).map(toWorldVersion)
  }

  /** @param id 版本 UUID。 @returns 找到的世界版本或 null。 */
  async findWorldVersion(id: string): Promise<WorldVersionRecord | null> {
    const row = this.client.prepare(`
      SELECT * FROM soul_versions WHERE id = ? AND subject_type = 'world'
    `).get(id)
    return row ? toWorldVersion(row) : null
  }

  /**
   * 统计会因删除世界版本而失去追溯依据的记录。
   * @param versionId 待删除世界版本 UUID。
   * @returns 直接后续版本数和引用该版本的历史任务数。
   */
  async getWorldVersionDeletionReferences(versionId: string): Promise<WorldVersionDeletionReferences> {
    const row = asRow(this.client.prepare(`
      SELECT
        (SELECT COUNT(*) FROM soul_versions WHERE subject_type = 'world' AND parent_version_id = ?) AS child_versions,
        (SELECT COUNT(DISTINCT run_id) FROM evidence_snapshots
          WHERE json_valid(metadata_json) = 1
            AND json_extract(metadata_json, '$.worldVersionId') = ?) AS runs
    `).get(versionId, versionId))
    return {
      childVersions: Number(row.child_versions),
      runs: Number(row.runs),
    }
  }

  /**
   * 在同一事务中再次核对安全条件并永久删除世界版本。
   * @param versionId 待删除世界版本 UUID。
   * @param timestamp 删除时间。
   * @returns 满足全部条件时为 1，否则为 0。
   */
  async deleteWorldVersion(versionId: string, timestamp: number): Promise<number> {
    return this.client.transaction(() => {
      // 条件写入删除语句，避免检查完成后版本被发布或产生新引用的竞态。
      const changes = this.client.prepare(`
        DELETE FROM soul_versions
        WHERE id = ?
          AND subject_type = 'world'
          AND NOT EXISTS (SELECT 1 FROM worlds WHERE active_soul_version_id = soul_versions.id)
          AND NOT EXISTS (SELECT 1 FROM soul_versions AS child WHERE child.parent_version_id = soul_versions.id)
          AND NOT EXISTS (
            SELECT 1 FROM evidence_snapshots
            WHERE json_valid(metadata_json) = 1
              AND json_extract(metadata_json, '$.worldVersionId') = soul_versions.id
          )
      `).run(versionId).changes
      if (changes === 1) insertAuditEvent(this.client, {
        actor: 'administrator', action: 'world_version_deleted', targetType: 'world_version',
        targetId: versionId, timestamp,
      })
      return changes
    })()
  }

  /** @param worldId 世界 UUID。 @returns 直接关联该世界的人物。 */
  async listWorldPersonas(worldId: string): Promise<PersonaRecord[]> {
    return this.client.prepare(`
      SELECT * FROM personas WHERE world_id = ? ORDER BY name, id
    `).all(worldId).map(toPersona)
  }

  /** @param worldId 世界 UUID。 @returns 直接关联该世界的资料。 */
  async listWorldSources(worldId: string): Promise<SourceMaterialRecord[]> {
    return this.client.prepare(`
      SELECT source_materials.* FROM source_materials
      INNER JOIN world_sources ON world_sources.source_id = source_materials.id
      WHERE world_sources.world_id = ?
      ORDER BY world_sources.priority, source_materials.name
    `).all(worldId).map(toSource)
  }

  /** @param worldId 世界 UUID。 @param timestamp 删除时间。 @returns 删除的世界行数；人物外键仍会阻止错误级联。 */
  async deleteWorld(worldId: string, timestamp: number): Promise<number> {
    return this.client.transaction(() => {
      const changes = this.client.prepare('DELETE FROM worlds WHERE id = ?').run(worldId).changes
      if (changes === 1) insertAuditEvent(this.client, {
        actor: 'administrator', action: 'world_deleted', targetType: 'world', targetId: worldId, timestamp,
      })
      return changes
    })()
  }

  /**
   * 查询指定模拟对象的唯一灵魂草稿。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @returns 当前草稿或 null。
   */
  async findSoulDraft(subjectType: SoulSubjectType, subjectId: string): Promise<SoulDraftRecord | null> {
    const subjectColumn = subjectType === 'world' ? 'world_id' : 'persona_id'
    const row = this.client.prepare(`
      SELECT * FROM soul_drafts WHERE subject_type = ? AND ${subjectColumn} = ?
    `).get(subjectType, subjectId)
    return row ? toSoulDraft(row) : null
  }

  /**
   * 原子替换指定对象的唯一灵魂草稿。
   * @param draft 已规范化草稿。
   * @returns 保存后的草稿。
   */
  async saveSoulDraft(draft: SoulDraftRecord): Promise<SoulDraftRecord> {
    return this.client.transaction(() => {
      const subjectColumn = draft.subjectType === 'world' ? 'world_id' : 'persona_id'
      this.client.prepare(`
        DELETE FROM soul_drafts WHERE subject_type = ? AND ${subjectColumn} = ?
      `).run(draft.subjectType, draft.subjectId)
      this.client.prepare(`
        INSERT INTO soul_drafts (
          id, subject_type, world_id, persona_id, base_version_id, chapters_json,
          runtime_summary, change_summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        draft.id,
        draft.subjectType,
        draft.subjectType === 'world' ? draft.subjectId : null,
        draft.subjectType === 'persona' ? draft.subjectId : null,
        draft.baseVersionId,
        JSON.stringify(draft.snapshot.chapters),
        draft.snapshot.runtimeSummary,
        draft.changeSummary,
        draft.createdAt,
        draft.updatedAt,
      )
      return draft
    }).immediate()
  }

  /**
   * 删除指定对象的当前灵魂草稿。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @returns 删除行数。
   */
  async deleteSoulDraft(subjectType: SoulSubjectType, subjectId: string): Promise<number> {
    const subjectColumn = subjectType === 'world' ? 'world_id' : 'persona_id'
    return this.client.prepare(`
      DELETE FROM soul_drafts WHERE subject_type = ? AND ${subjectColumn} = ?
    `).run(subjectType, subjectId).changes
  }

  /**
   * 查询指定对象的全部不可变灵魂版本。
   * @param subjectType 对象类型。
   * @param subjectId 对象 UUID。
   * @returns 新版本在前的版本记录。
   */
  async listSoulVersions(subjectType: SoulSubjectType, subjectId: string): Promise<SoulVersionRecord[]> {
    const subjectColumn = subjectType === 'world' ? 'world_id' : 'persona_id'
    return this.client.prepare(`
      SELECT * FROM soul_versions
      WHERE subject_type = ? AND ${subjectColumn} = ?
      ORDER BY created_at DESC, id DESC
    `).all(subjectType, subjectId).map(toSoulVersion)
  }

  /**
   * 查询单个不可变灵魂版本。
   * @param versionId 版本 UUID。
   * @returns 版本或 null。
   */
  async findSoulVersion(versionId: string): Promise<SoulVersionRecord | null> {
    const row = this.client.prepare('SELECT * FROM soul_versions WHERE id = ?').get(versionId)
    return row ? toSoulVersion(row) : null
  }

  /**
   * 原子发布草稿、更新当前版本指针并删除草稿。
   * @param record 发布命令。
   * @returns 新版本；草稿状态变化时返回 null。
   */
  async publishSoulDraft(record: PublishSoulDraftRecord): Promise<SoulVersionRecord | null> {
    return this.client.transaction(() => {
      const rawDraft = this.client.prepare('SELECT * FROM soul_drafts WHERE id = ?').get(record.draftId)
      if (!rawDraft) return null
      const draft = toSoulDraft(rawDraft)
      const version: SoulVersionRecord = {
        id: record.versionId,
        subjectType: draft.subjectType,
        subjectId: draft.subjectId,
        parentVersionId: draft.baseVersionId,
        status: 'published',
        snapshot: draft.snapshot,
        runtimeTokenCount: record.runtimeTokenCount,
        tokenCounter: record.tokenCounter,
        changeSummary: draft.changeSummary,
        publishedAt: record.timestamp,
        createdAt: record.timestamp,
      }
      this.client.prepare(`
        INSERT INTO soul_versions (
          id, subject_type, world_id, persona_id, parent_version_id, chapters_json,
          runtime_summary, runtime_token_count, token_counter, change_summary,
          status, published_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
      `).run(
        version.id,
        version.subjectType,
        version.subjectType === 'world' ? version.subjectId : null,
        version.subjectType === 'persona' ? version.subjectId : null,
        version.parentVersionId,
        JSON.stringify(version.snapshot.chapters),
        version.snapshot.runtimeSummary,
        version.runtimeTokenCount,
        version.tokenCounter,
        version.changeSummary,
        version.publishedAt,
        version.createdAt,
      )
      const subjectTable = version.subjectType === 'world' ? 'worlds' : 'personas'
      this.client.prepare(`
        UPDATE ${subjectTable} SET active_soul_version_id = ?, updated_at = ? WHERE id = ?
      `).run(version.id, record.timestamp, version.subjectId)
      const deleted = this.client.prepare('DELETE FROM soul_drafts WHERE id = ?').run(record.draftId)
      if (deleted.changes !== 1) return null
      insertAuditEvent(this.client, {
        actor: 'administrator',
        action: 'soul_version_published',
        targetType: 'soul_version',
        targetId: version.id,
        details: { subjectType: version.subjectType, subjectId: version.subjectId },
        timestamp: record.timestamp,
      })
      return version
    }).immediate()
  }

  /** @returns 按更新时间倒序的资料记录。 */
  async listSources(): Promise<SourceMaterialRecord[]> {
    return this.client.prepare('SELECT * FROM source_materials ORDER BY updated_at DESC, id').all().map(toSource)
  }

  /** @param id 资料 UUID。 @returns 找到的资料或 null。 */
  async findSource(id: string): Promise<SourceMaterialRecord | null> {
    const row = this.client.prepare('SELECT * FROM source_materials WHERE id = ?').get(id)
    return row ? toSource(row) : null
  }

  /**
   * 原子写入资料和全部切片；迁移中的触发器同步 FTS5。
   * @param record 已验证并处理的资料命令。
   * @returns 无返回值。
   */
  async createSource(record: CreateSourceRecord): Promise<void> {
    this.client.transaction(() => {
      this.client.prepare(`
        INSERT INTO source_materials (
          id, name, role, input_type, content_hash, content_text, original_file_path, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.name,
        record.role,
        record.inputType,
        record.contentHash,
        record.contentText,
        record.originalFilePath,
        record.timestamp,
        record.timestamp,
      )
      insertChunks(this.client, record.chunks)
    })()
  }

  /**
   * 原子替换资料可变正文和切片，同时保留资料标识与创建时间。
   * @param record 替换命令。
   * @returns 资料存在并更新时为 true。
   */
  async replaceSource(record: CreateSourceRecord): Promise<boolean> {
    return this.client.transaction(() => {
      const updated = this.client.prepare(`
        UPDATE source_materials
        SET name = ?, role = ?, input_type = ?, content_hash = ?, content_text = ?,
            original_file_path = ?, updated_at = ?
        WHERE id = ?
      `).run(
        record.name,
        record.role,
        record.inputType,
        record.contentHash,
        record.contentText,
        record.originalFilePath,
        record.timestamp,
        record.id,
      )
      if (updated.changes !== 1) {
        return false
      }
      this.client.prepare('DELETE FROM source_chunks WHERE source_id = ?').run(record.id)
      insertChunks(this.client, record.chunks)
      return true
    })()
  }

  /** @param sourceId 资料 UUID。 @returns 按序号排序的切片。 */
  async listSourceChunks(sourceId: string): Promise<SourceChunkRecord[]> {
    return this.client.prepare(`
      SELECT * FROM source_chunks WHERE source_id = ? ORDER BY ordinal
    `).all(sourceId).map(toChunk)
  }

  /** @param sourceId 资料 UUID。 @returns 人物和世界关联的统一视图。 */
  async listSourceLinks(sourceId: string): Promise<SourceLinkRecord[]> {
    const rows = this.client.prepare(`
      SELECT 'persona' AS target_type, personas.id AS target_id, personas.name AS target_name,
             persona_sources.priority AS priority
      FROM persona_sources
      INNER JOIN personas ON personas.id = persona_sources.persona_id
      WHERE persona_sources.source_id = ?
      UNION ALL
      SELECT 'world' AS target_type, worlds.id AS target_id, worlds.name AS target_name,
             world_sources.priority AS priority
      FROM world_sources
      INNER JOIN worlds ON worlds.id = world_sources.world_id
      WHERE world_sources.source_id = ?
      ORDER BY priority, target_name
    `).all(sourceId, sourceId)
    return rows.map((row) => {
      const value = asRow(row)
      const targetType = value.target_type as 'persona' | 'world'
      const targetId = String(value.target_id)
      return {
        id: `${targetType}:${targetId}`,
        targetType,
        targetId,
        targetName: String(value.target_name),
        priority: Number(value.priority),
      }
    })
  }

  /**
   * 新建关联；重复关联只更新优先级。
   * @param sourceId 资料 UUID。
   * @param targetType 人物或世界。
   * @param targetId 目标 UUID。
   * @param priority 非负整数优先级。
   * @returns 无返回值。
   */
  async linkSource(sourceId: string, targetType: 'persona' | 'world', targetId: string, priority: number): Promise<void> {
    const targetColumn = targetType === 'persona' ? 'persona_id' : 'world_id'
    const table = targetType === 'persona' ? 'persona_sources' : 'world_sources'
    this.client.prepare(`
      INSERT INTO ${table} (${targetColumn}, source_id, priority) VALUES (?, ?, ?)
      ON CONFLICT (${targetColumn}, source_id) DO UPDATE SET priority = excluded.priority
    `).run(targetId, sourceId, priority)
  }

  /**
   * 解析并删除受控复合关联标识。
   * @param sourceId 资料 UUID。
   * @param linkId `persona:UUID` 或 `world:UUID`。
   * @returns 删除的关联行数。
   */
  async unlinkSource(sourceId: string, linkId: string): Promise<number> {
    const separator = linkId.indexOf(':')
    const targetType = linkId.slice(0, separator)
    const targetId = linkId.slice(separator + 1)
    if (separator < 1 || (targetType !== 'persona' && targetType !== 'world')) {
      return 0
    }
    const targetColumn = targetType === 'persona' ? 'persona_id' : 'world_id'
    const table = targetType === 'persona' ? 'persona_sources' : 'world_sources'
    return this.client.prepare(`
      DELETE FROM ${table} WHERE source_id = ? AND ${targetColumn} = ?
    `).run(sourceId, targetId).changes
  }

  /** @param sourceId 资料 UUID。 @param timestamp 删除时间。 @returns 删除的资料行数；外键会阻止删除仍有关联的资料。 */
  async deleteSource(sourceId: string, timestamp: number): Promise<number> {
    return this.client.transaction(() => {
      const changes = this.client.prepare('DELETE FROM source_materials WHERE id = ?').run(sourceId).changes
      if (changes === 1) insertAuditEvent(this.client, {
        actor: 'administrator', action: 'source_deleted', targetType: 'source', targetId: sourceId, timestamp,
      })
      return changes
    })()
  }

  /**
   * 使用安全短语形式执行 FTS5 查询，返回独立正文和哈希供后续复制为证据快照。
   * @param query 用户检索词。
   * @param limit 最大结果数。
   * @returns 相关性排序的切片。
   */
  async searchSourceChunks(query: string, limit: number): Promise<SourceChunkRecord[]> {
    if ([...query].length < 3) {
      return this.client.prepare(`
        SELECT * FROM source_chunks
        WHERE heading LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
        ORDER BY source_id, ordinal
        LIMIT ?
      `).all(toLikePattern(query), toLikePattern(query), limit).map(toChunk)
    }
    const phrase = query.replaceAll('"', '""')
    return this.client.prepare(`
      SELECT source_chunks.* FROM source_chunks_fts
      INNER JOIN source_chunks ON source_chunks.rowid = source_chunks_fts.rowid
      WHERE source_chunks_fts MATCH ?
      ORDER BY bm25(source_chunks_fts), source_chunks.source_id, source_chunks.ordinal
      LIMIT ?
    `).all(`"${phrase}"`, limit).map(toChunk)
  }
}

/**
 * 转义 SQLite LIKE 通配符，保证短检索词按字面匹配。
 * @param value 用户检索词。
 * @returns 带首尾通配符的安全参数值。
 */
function toLikePattern(value: string): string {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
}

/**
 * 在当前事务中批量写入资料切片。
 * @param client SQLite 客户端。
 * @param chunks 顺序稳定的切片。
 * @returns 无返回值。
 */
function insertChunks(client: BetterSqliteDatabase, chunks: SourceChunkRecord[]): void {
  const insert = client.prepare(`
    INSERT INTO source_chunks (id, source_id, ordinal, heading, content, content_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const chunk of chunks) {
    insert.run(chunk.id, chunk.sourceId, chunk.ordinal, chunk.heading, chunk.content, chunk.contentHash)
  }
}

/** @param value 未知 SQLite 行。 @returns 可按列名读取的行。 */
function asRow(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

/** @param value SQLite 人物行。 @returns 领域人物记录。 */
function toPersona(value: unknown): PersonaRecord {
  const row = asRow(value)
  return {
    id: String(row.id),
    worldId: row.world_id === null ? null : String(row.world_id),
    name: String(row.name),
    origin: row.origin as PersonaRecord['origin'],
    activeVersionId: row.active_soul_version_id === null ? null : String(row.active_soul_version_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

/** @param value SQLite 人物版本行。 @returns 已校验快照的领域版本。 */
function toPersonaVersion(value: unknown): PersonaVersionRecord {
  const row = asRow(value)
  return {
    id: String(row.id),
    personaId: String(row.persona_id),
    parentVersionId: row.parent_version_id === null ? null : String(row.parent_version_id),
    status: row.status as PersonaVersionRecord['status'],
    snapshot: soulSnapshotSchema.parse({
      chapters: JSON.parse(String(row.chapters_json)),
      runtimeSummary: String(row.runtime_summary),
    }),
    runtimeTokenCount: Number(row.runtime_token_count),
    tokenCounter: String(row.token_counter),
    changeSummary: String(row.change_summary),
    publishedAt: Number(row.published_at),
    createdAt: Number(row.created_at),
  }
}

/** @param value SQLite 世界行。 @returns 领域世界记录。 */
function toWorld(value: unknown): WorldRecord {
  const row = asRow(value)
  return {
    id: String(row.id),
    name: String(row.name),
    summary: String(row.summary),
    activeVersionId: row.active_soul_version_id === null ? null : String(row.active_soul_version_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

/** @param value SQLite 世界版本行。 @returns 已校验快照的领域版本。 */
function toWorldVersion(value: unknown): WorldVersionRecord {
  const row = asRow(value)
  return {
    id: String(row.id),
    worldId: String(row.world_id),
    parentVersionId: row.parent_version_id === null ? null : String(row.parent_version_id),
    status: row.status as WorldVersionRecord['status'],
    snapshot: soulSnapshotSchema.parse({
      chapters: JSON.parse(String(row.chapters_json)),
      runtimeSummary: String(row.runtime_summary),
    }),
    runtimeTokenCount: Number(row.runtime_token_count),
    tokenCounter: String(row.token_counter),
    changeSummary: String(row.change_summary),
    publishedAt: Number(row.published_at),
    createdAt: Number(row.created_at),
  }
}

/**
 * 把 SQLite 灵魂草稿行转换为已校验领域记录。
 * @param value SQLite 草稿行。
 * @returns 灵魂草稿领域记录。
 */
function toSoulDraft(value: unknown): SoulDraftRecord {
  const row = asRow(value)
  const subjectType = row.subject_type as SoulSubjectType
  return {
    id: String(row.id),
    subjectType,
    subjectId: String(subjectType === 'world' ? row.world_id : row.persona_id),
    baseVersionId: row.base_version_id === null ? null : String(row.base_version_id),
    snapshot: soulSnapshotSchema.parse({
      chapters: JSON.parse(String(row.chapters_json)),
      runtimeSummary: String(row.runtime_summary),
    }),
    changeSummary: String(row.change_summary),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

/**
 * 把 SQLite 灵魂版本行转换为已校验领域记录。
 * @param value SQLite 版本行。
 * @returns 灵魂版本领域记录。
 */
function toSoulVersion(value: unknown): SoulVersionRecord {
  const row = asRow(value)
  const subjectType = row.subject_type as SoulSubjectType
  return {
    id: String(row.id),
    subjectType,
    subjectId: String(subjectType === 'world' ? row.world_id : row.persona_id),
    parentVersionId: row.parent_version_id === null ? null : String(row.parent_version_id),
    status: row.status as SoulVersionRecord['status'],
    snapshot: soulSnapshotSchema.parse({
      chapters: JSON.parse(String(row.chapters_json)),
      runtimeSummary: String(row.runtime_summary),
    }),
    runtimeTokenCount: Number(row.runtime_token_count),
    tokenCounter: String(row.token_counter),
    changeSummary: String(row.change_summary),
    publishedAt: Number(row.published_at),
    createdAt: Number(row.created_at),
  }
}

/** @param value SQLite 资料行。 @returns 领域资料记录。 */
function toSource(value: unknown): SourceMaterialRecord {
  const row = asRow(value)
  return {
    id: String(row.id),
    name: String(row.name),
    role: row.role as SourceMaterialRecord['role'],
    inputType: row.input_type as SourceMaterialRecord['inputType'],
    contentHash: String(row.content_hash),
    contentText: String(row.content_text),
    originalFilePath: row.original_file_path === null ? null : String(row.original_file_path),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

/** @param value SQLite 切片行。 @returns 领域切片记录。 */
function toChunk(value: unknown): SourceChunkRecord {
  const row = asRow(value)
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    ordinal: Number(row.ordinal),
    heading: row.heading === null ? null : String(row.heading),
    content: String(row.content),
    contentHash: String(row.content_hash),
  }
}
