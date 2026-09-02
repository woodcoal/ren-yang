import { createHash, randomUUID } from 'node:crypto'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type {
  GrowthRecordView,
  GrowthMaterialView,
  LearningPromptDraftView,
  LearningPromptType,
  LearningPromptVersionView,
  LearningPromptWorkspaceView,
  MemoryRecordView,
  OpenVikingDerivedMemoryView,
  PersonaExternalRecordView,
  PersonaFeedbackSourceView,
  PersonaOperationRecordView,
  WorldGrowthSourceView,
} from '../../../shared/types/learning'
import type {
  CreateGrowthRecord,
  CreatePersonaOperationRecord,
  CreatePersonaFeedbackSourceRecord,
  LearningRepository,
  PublishLearningPromptDraftRecord,
  SaveGrowthMaterialRecord,
  SaveLearningPromptDraftRecord,
  SavePersonaExternalRecord,
  UpdateGrowthRecord,
} from '../../ports/LearningRepository'
import { insertAuditEvent } from './AuditSql'

/** 使用 SQLite 短事务保存成长原始资料、成长、处理记录和记忆事实。 */
export class SqliteLearningRepository implements LearningRepository {
  /**
   * 创建统一学习事实仓储。
   * @param client 已启用外键的 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @returns 当前成长素材及来源同步状态。 */
  async listGrowthMaterials(subjectType: 'world' | 'persona', subjectId: string): Promise<GrowthMaterialView[]> {
    const scopeColumn = subjectType === 'world' ? 'world_id' : 'persona_id'
    const relationTable = subjectType === 'world' ? 'world_sources' : 'persona_sources'
    return this.client.prepare(`
      SELECT growth_materials.*, source_materials.content_hash AS current_source_hash
      FROM growth_materials
      LEFT JOIN ${relationTable} AS source_relations
        ON growth_materials.source_type = 'source_material'
        AND source_relations.${scopeColumn} = growth_materials.${scopeColumn}
        AND source_relations.source_id = growth_materials.source_id
      LEFT JOIN source_materials
        ON growth_materials.source_type = 'source_material'
        AND source_materials.id = growth_materials.source_id
        AND source_relations.source_id IS NOT NULL
      WHERE growth_materials.subject_type = ? AND growth_materials.${scopeColumn} = ?
      ORDER BY growth_materials.updated_at DESC, growth_materials.id DESC
    `).all(subjectType, subjectId).map(toGrowthMaterial)
  }

  /** @param records 已校验的资料库成长素材。 @returns 新建或刷新完成时结束。 */
  async importGrowthMaterials(records: SaveGrowthMaterialRecord[]): Promise<void> {
    this.client.transaction(() => {
      for (const record of records) {
        const scopeColumn = record.subjectType === 'world' ? 'world_id' : 'persona_id'
        const existing = this.client.prepare(`
          SELECT id FROM growth_materials
          WHERE subject_type = ? AND ${scopeColumn} = ? AND source_type = 'source_material' AND source_id = ?
        `).get(record.subjectType, record.subjectId, record.sourceId) as { id: string } | undefined
        if (existing) {
          this.client.prepare(`
            UPDATE growth_materials
            SET title = ?, content_snapshot = ?, content_hash = ?, source_hash = ?,
              importance = ?, is_enabled = 1, updated_at = ?
            WHERE id = ?
          `).run(
            record.title, record.content, hashContent(record.content), record.sourceHash,
            record.importance, record.timestamp, existing.id,
          )
          continue
        }
        this.insertGrowthMaterial(record)
      }
      const firstRecord = records[0]
      if (!firstRecord) return
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'growth_materials_imported',
        targetType: 'growth_material', targetId: firstRecord.subjectId, timestamp: firstRecord.timestamp,
        details: { count: records.length },
      })
    }).immediate()
  }

  /** @param record 手工成长素材。 @returns 保存完成时结束。 */
  async createGrowthMaterial(record: SaveGrowthMaterialRecord): Promise<void> {
    this.client.transaction(() => {
      this.insertGrowthMaterial(record)
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'growth_material_created',
        targetType: 'growth_material', targetId: record.id, timestamp: record.timestamp,
      })
    }).immediate()
  }

  /** @param record 已校验的成长素材新内容。 @returns 更新成功时为 true。 */
  async updateGrowthMaterial(record: SaveGrowthMaterialRecord): Promise<boolean> {
    const scopeColumn = record.subjectType === 'world' ? 'world_id' : 'persona_id'
    const changed = this.client.prepare(`
      UPDATE growth_materials
      SET title = ?, content_snapshot = ?, content_hash = ?, importance = ?, updated_at = ?
      WHERE id = ? AND subject_type = ? AND ${scopeColumn} = ?
    `).run(
      record.title, record.content, hashContent(record.content), record.importance,
      record.timestamp, record.id, record.subjectType, record.subjectId,
    ).changes === 1
    if (changed) {
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'growth_material_updated',
        targetType: 'growth_material', targetId: record.id, timestamp: record.timestamp,
      })
    }
    return changed
  }

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param ids 素材 UUID。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 更新数量。 */
  async updateGrowthMaterialStates(subjectType: 'world' | 'persona', subjectId: string, ids: string[], isEnabled: boolean, timestamp: number): Promise<number> {
    return this.updateScopedEnabledState({
      table: 'growth_materials', scopeColumn: subjectType === 'world' ? 'world_id' : 'persona_id',
      idColumn: 'id', scopeId: subjectId, ids, isEnabled, timestamp,
      extraWhere: `subject_type = '${subjectType}'`,
    })
  }

  /** @param subjectType 对象类型。 @param subjectId 对象 UUID。 @param ids 素材 UUID。 @param timestamp 删除时间。 @returns 删除数量。 */
  async deleteGrowthMaterials(subjectType: 'world' | 'persona', subjectId: string, ids: string[], timestamp: number): Promise<number> {
    const scopeColumn = subjectType === 'world' ? 'world_id' : 'persona_id'
    return this.client.transaction(() => {
      const placeholders = createPlaceholders(ids)
      const rows = this.client.prepare(`
        SELECT id FROM growth_materials
        WHERE subject_type = ? AND ${scopeColumn} = ? AND id IN (${placeholders})
      `).all(subjectType, subjectId, ...ids) as Array<{ id: string }>
      if (rows.length !== ids.length) return 0
      const changes = this.client.prepare(`
        DELETE FROM growth_materials
        WHERE subject_type = ? AND ${scopeColumn} = ? AND id IN (${placeholders})
      `).run(subjectType, subjectId, ...ids).changes
      for (const id of ids) {
        insertAuditEvent(this.client, {
          actor: 'administrator', action: 'growth_material_deleted',
          targetType: 'growth_material', targetId: id, timestamp,
        })
      }
      return changes
    }).immediate()
  }

  /** @param promptType 提示词类型。 @param subjectId 对象 UUID。 @returns 当前提示词工作区或 null。 */
  async findLearningPromptWorkspace(promptType: LearningPromptType, subjectId: string): Promise<LearningPromptWorkspaceView | null> {
    const scopeColumn = promptType === 'world_growth' ? 'world_id' : 'persona_id'
    const prompt = this.client.prepare(`
      SELECT * FROM learning_prompts WHERE prompt_type = ? AND ${scopeColumn} = ?
    `).get(promptType, subjectId) as Record<string, unknown> | undefined
    if (!prompt) return null
    const versions = this.client.prepare(`
      SELECT * FROM learning_prompt_versions WHERE prompt_id = ? ORDER BY version_no DESC
    `).all(String(prompt.id)).map(toLearningPromptVersion)
    const draftRow = this.client.prepare(`
      SELECT * FROM learning_prompt_drafts WHERE prompt_id = ?
    `).get(String(prompt.id))
    return {
      promptType,
      activeVersion: versions.find(version => version.id === nullableString(prompt.active_version_id)) ?? null,
      draft: draftRow ? toLearningPromptDraft(draftRow) : null,
      versions,
    }
  }

  /** @param record 草稿保存命令。 @returns 保存后的提示词工作区。 */
  async saveLearningPromptDraft(record: SaveLearningPromptDraftRecord): Promise<LearningPromptWorkspaceView> {
    this.client.transaction(() => {
      const scopeColumn = record.promptType === 'world_growth' ? 'world_id' : 'persona_id'
      const worldId = record.promptType === 'world_growth' ? record.subjectId : null
      const personaId = record.promptType === 'world_growth' ? null : record.subjectId
      this.client.prepare(`
        INSERT OR IGNORE INTO learning_prompts (
          id, prompt_type, world_id, persona_id, active_version_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?)
      `).run(record.promptId, record.promptType, worldId, personaId, record.timestamp, record.timestamp)
      const prompt = this.client.prepare(`
        SELECT id FROM learning_prompts WHERE prompt_type = ? AND ${scopeColumn} = ?
      `).get(record.promptType, record.subjectId) as { id: string }
      if (record.baseVersionId) {
        const version = this.client.prepare(`
          SELECT id FROM learning_prompt_versions WHERE id = ? AND prompt_id = ?
        `).get(record.baseVersionId, prompt.id)
        if (!version) throw new Error('学习提示词草稿基础版本不属于当前对象')
      }
      this.client.prepare(`
        INSERT INTO learning_prompt_drafts (
          id, prompt_id, base_version_id, prompt_text, content_hash,
          source_analysis_batch_id, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(prompt_id) DO UPDATE SET
          base_version_id = excluded.base_version_id,
          prompt_text = excluded.prompt_text,
          content_hash = excluded.content_hash,
          source_analysis_batch_id = excluded.source_analysis_batch_id,
          created_by = excluded.created_by,
          updated_at = excluded.updated_at
      `).run(
        record.draftId, prompt.id, record.baseVersionId, record.promptText,
        hashContent(record.promptText), record.sourceAnalysisBatchId, record.createdBy,
        record.timestamp, record.timestamp,
      )
      this.client.prepare(`UPDATE learning_prompts SET updated_at = ? WHERE id = ?`).run(record.timestamp, prompt.id)
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'learning_prompt_draft_saved',
        targetType: 'learning_prompt', targetId: prompt.id, timestamp: record.timestamp,
      })
    }).immediate()
    const workspace = await this.findLearningPromptWorkspace(record.promptType, record.subjectId)
    if (!workspace) throw new Error('学习提示词草稿写入后无法读取')
    return workspace
  }

  /** @param promptType 提示词类型。 @param subjectId 对象 UUID。 @returns 删除数量。 */
  async deleteLearningPromptDraft(promptType: LearningPromptType, subjectId: string): Promise<number> {
    const scopeColumn = promptType === 'world_growth' ? 'world_id' : 'persona_id'
    return this.client.prepare(`
      DELETE FROM learning_prompt_drafts WHERE prompt_id = (
        SELECT id FROM learning_prompts WHERE prompt_type = ? AND ${scopeColumn} = ?
      )
    `).run(promptType, subjectId).changes
  }

  /** @param promptType 提示词类型。 @param subjectId 对象 UUID。 @param versionId 历史版本 UUID。 @returns 归属正确的历史版本或 null。 */
  async findLearningPromptVersion(promptType: LearningPromptType, subjectId: string, versionId: string): Promise<LearningPromptVersionView | null> {
    const scopeColumn = promptType === 'world_growth' ? 'world_id' : 'persona_id'
    const row = this.client.prepare(`
      SELECT learning_prompt_versions.* FROM learning_prompt_versions
      INNER JOIN learning_prompts ON learning_prompts.id = learning_prompt_versions.prompt_id
      WHERE learning_prompt_versions.id = ? AND learning_prompts.prompt_type = ? AND learning_prompts.${scopeColumn} = ?
    `).get(versionId, promptType, subjectId)
    return row ? toLearningPromptVersion(row) : null
  }

  /** @param record 草稿发布命令。 @returns 新发布版本或 null。 */
  async publishLearningPromptDraft(record: PublishLearningPromptDraftRecord): Promise<LearningPromptVersionView | null> {
    const scopeColumn = record.promptType === 'world_growth' ? 'world_id' : 'persona_id'
    const published = this.client.transaction(() => {
      const row = this.client.prepare(`
        SELECT learning_prompts.id AS prompt_id, learning_prompts.active_version_id,
          learning_prompt_drafts.*
        FROM learning_prompts
        INNER JOIN learning_prompt_drafts ON learning_prompt_drafts.prompt_id = learning_prompts.id
        WHERE learning_prompts.prompt_type = ? AND learning_prompts.${scopeColumn} = ?
      `).get(record.promptType, record.subjectId) as Record<string, unknown> | undefined
      if (!row) return false
      const versionNo = Number((this.client.prepare(`
        SELECT COALESCE(MAX(version_no), 0) + 1 AS value
        FROM learning_prompt_versions WHERE prompt_id = ?
      `).get(String(row.prompt_id)) as { value: number }).value)
      this.client.prepare(`
        INSERT INTO learning_prompt_versions (
          id, prompt_id, version_no, parent_version_id, prompt_text, content_hash,
          source_analysis_batch_id, change_summary, created_by, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.versionId, String(row.prompt_id), versionNo,
        nullableString(row.base_version_id) ?? nullableString(row.active_version_id),
        String(row.prompt_text), String(row.content_hash), nullableString(row.source_analysis_batch_id),
        record.changeSummary, String(row.created_by), record.timestamp,
      )
      this.client.prepare(`
        UPDATE learning_prompts SET active_version_id = ?, updated_at = ? WHERE id = ?
      `).run(record.versionId, record.timestamp, String(row.prompt_id))
      this.client.prepare(`DELETE FROM learning_prompt_drafts WHERE prompt_id = ?`).run(String(row.prompt_id))
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'learning_prompt_published',
        targetType: 'learning_prompt', targetId: String(row.prompt_id), timestamp: record.timestamp,
        details: { versionNo },
      })
      return true
    }).immediate()
    return published
      ? await this.findLearningPromptVersion(record.promptType, record.subjectId, record.versionId)
      : null
  }

  /** @param promptType 提示词类型。 @param subjectId 对象 UUID。 @returns 当前已发布完整提示词正文或 null。 */
  async findActiveLearningPromptText(promptType: LearningPromptType, subjectId: string): Promise<string | null> {
    const scopeColumn = promptType === 'world_growth' ? 'world_id' : 'persona_id'
    const row = this.client.prepare(`
      SELECT learning_prompt_versions.prompt_text FROM learning_prompts
      INNER JOIN learning_prompt_versions ON learning_prompt_versions.id = learning_prompts.active_version_id
      WHERE learning_prompts.prompt_type = ? AND learning_prompts.${scopeColumn} = ?
    `).get(promptType, subjectId) as { prompt_text: string } | undefined
    return row?.prompt_text ?? null
  }

  /** @param worldId 世界 UUID。 @returns 世界资料及成长启用状态。 */
  async listWorldGrowthSources(worldId: string): Promise<WorldGrowthSourceView[]> {
    return this.client.prepare(`
      SELECT source_materials.id, source_materials.name, source_materials.content_text, source_materials.content_hash,
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

  /** @param personaId 人物 UUID。 @param ids 反馈资料 UUID。 @param timestamp 删除时间。 @param deferRemoteDeletion 是否先等待 OpenViking。 @returns 已受理数量。 */
  async deletePersonaFeedbackSources(personaId: string, ids: string[], timestamp: number, deferRemoteDeletion: boolean): Promise<number> {
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
      if (deferRemoteDeletion) {
        const changes = this.client.prepare(`
          UPDATE persona_feedback_sources
          SET deletion_state = 'pending_remote_delete', is_enabled = 0, updated_at = ?
          WHERE persona_id = ? AND id IN (${placeholders})
        `).run(timestamp, personaId, ...ids).changes
        for (const id of ids) {
          insertAuditEvent(this.client, {
            actor: 'administrator', action: 'persona_feedback_source_deletion_requested',
            targetType: 'persona_feedback_source', targetId: id, timestamp,
          })
        }
        return changes
      }
      this.client.prepare(`
        UPDATE analysis_batch_inputs SET content_snapshot = NULL, source_available = 0
        WHERE input_type = 'persona_feedback_source' AND input_id IN (${placeholders})
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
    await this.createGrowthBatch([record])
  }

  /**
   * 在一个短事务内批量创建成长及其第一版证据链。
   * @param records 已由应用服务校验对象范围和来源正文的创建命令。
   * @returns 整批创建并写入审计后结束；任意来源失效时整批回滚。
   */
  async createGrowthBatch(records: CreateGrowthRecord[]): Promise<void> {
    this.client.transaction(() => {
      for (const record of records) this.insertGrowth(record)
    }).immediate()
  }

  /**
   * 为指定成长建立新不可变修订，并继承上一版证据快照。
   * @param record 已校验的新修订正文、范围、重要程度和对象范围。
   * @returns 成长存在且不是已取代历史时返回 true，否则返回 false。
   */
  async updateGrowth(record: UpdateGrowthRecord): Promise<boolean> {
    const scopeColumn = record.subjectType === 'world' ? 'world_id' : 'persona_id'
    return this.client.transaction(() => {
      const current = this.client.prepare(`
        SELECT growth_records.current_revision_id, growth_revisions.revision_no
        FROM growth_records
        INNER JOIN growth_revisions ON growth_revisions.id = growth_records.current_revision_id
        WHERE growth_records.id = ? AND growth_records.subject_type = ?
          AND growth_records.${scopeColumn} = ? AND growth_records.status <> 'superseded'
      `).get(record.id, record.subjectType, record.subjectId) as {
        current_revision_id: string
        revision_no: number
      } | undefined
      if (!current) return false

      this.client.prepare(`
        INSERT INTO growth_revisions (
          id, growth_id, revision_no, content, content_hash, scope, importance,
          conflict_summary, analysis_batch_id, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'user', ?)
      `).run(
        record.revisionId, record.id, Number(current.revision_no) + 1,
        record.content, hashContent(record.content), record.scope, record.importance, record.timestamp,
      )
      this.copyGrowthEvidence(current.current_revision_id, record.revisionId)
      this.client.prepare(`
        UPDATE growth_records
        SET current_revision_id = ?, status = 'candidate', superseded_by_id = NULL, updated_at = ?
        WHERE id = ?
      `).run(record.revisionId, record.timestamp, record.id)
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'growth_revision_created',
        targetType: 'growth', targetId: record.id, timestamp: record.timestamp,
      })
      return true
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

  /**
   * 核对所选成长全部属于当前对象后永久删除成长及其修订证据。
   * @param subjectType 世界或人物对象类型。
   * @param subjectId 当前世界或人物 UUID。
   * @param ids 待删除成长 UUID；调用方保证非空且已去重。
   * @param timestamp 审计事件使用的删除时间。
   * @returns 全部删除时返回所选数量，范围不完整时返回零。
   */
  async deleteGrowth(subjectType: 'world' | 'persona', subjectId: string, ids: string[], timestamp: number): Promise<number> {
    const scopeColumn = subjectType === 'world' ? 'world_id' : 'persona_id'
    return this.client.transaction(() => {
      const placeholders = createPlaceholders(ids)
      const row = this.client.prepare(`
        SELECT COUNT(*) AS count FROM growth_records
        WHERE subject_type = ? AND ${scopeColumn} = ? AND id IN (${placeholders})
      `).get(subjectType, subjectId, ...ids) as { count: number }
      if (Number(row.count) !== ids.length) return 0

      // 解除其他历史记录对待删成长的“已被取代”文字关系，避免保留悬空标识。
      this.client.prepare(`
        UPDATE growth_records SET superseded_by_id = NULL
        WHERE superseded_by_id IN (${placeholders})
      `).run(...ids)
      const changes = this.client.prepare(`
        DELETE FROM growth_records
        WHERE subject_type = ? AND ${scopeColumn} = ? AND id IN (${placeholders})
      `).run(subjectType, subjectId, ...ids).changes
      for (const id of ids) {
        insertAuditEvent(this.client, {
          actor: 'administrator', action: 'growth_deleted',
          targetType: 'growth', targetId: id, timestamp,
        })
      }
      return changes
    }).immediate()
  }

  /** @param personaId 人物 UUID。 @returns 人物处理记录。 */
  async listPersonaOperationRecords(personaId: string): Promise<PersonaOperationRecordView[]> {
    return this.client.prepare(`
      SELECT persona_operation_records.*, generation_runs.input_json
      FROM persona_operation_records
      INNER JOIN generation_runs ON generation_runs.id = persona_operation_records.run_id
      WHERE persona_operation_records.persona_id = ?
      ORDER BY persona_operation_records.created_at DESC, persona_operation_records.id DESC
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

  /** @param personaId 人物 UUID。 @param recordId 处理记录 UUID。 @param importance 新评分。 @param timestamp 更新时间。 @returns 是否更新。 */
  async updatePersonaOperationRecordImportance(personaId: string, recordId: string, importance: number, timestamp: number): Promise<boolean> {
    const changed = this.client.prepare(`
      UPDATE persona_operation_records SET importance = ?, updated_at = ?
      WHERE id = ? AND persona_id = ?
    `).run(importance, timestamp, recordId, personaId).changes === 1
    if (changed) {
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'operation_record_importance_updated',
        targetType: 'persona_operation_record', targetId: recordId, timestamp,
        details: { importance },
      })
    }
    return changed
  }

  /** @param personaId 人物 UUID。 @returns 按发生日期和更新时间倒序的第三方经历记录。 */
  async listPersonaExternalRecords(personaId: string): Promise<PersonaExternalRecordView[]> {
    return this.client.prepare(`
      SELECT * FROM persona_external_records
      WHERE persona_id = ? ORDER BY occurred_on DESC, updated_at DESC, id DESC
    `).all(personaId).map(toExternalRecord)
  }

  /** @param record 已校验的新第三方经历记录。 @returns 写入完成时结束。 */
  async createPersonaExternalRecord(record: SavePersonaExternalRecord): Promise<void> {
    this.client.prepare(`
      INSERT INTO persona_external_records (
        id, persona_id, occurred_on, content, references_json, is_enabled, importance, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      record.id, record.personaId, record.occurredOn, record.content, JSON.stringify(record.references),
      record.importance, record.timestamp, record.timestamp,
    )
    insertAuditEvent(this.client, {
      actor: 'administrator', action: 'persona_external_record_created',
      targetType: 'persona_external_record', targetId: record.id, timestamp: record.timestamp,
    })
  }

  /** @param record 已存在第三方经历记录的新内容。 @returns 记录存在且归属正确时为 true。 */
  async updatePersonaExternalRecord(record: SavePersonaExternalRecord): Promise<boolean> {
    const changed = this.client.prepare(`
      UPDATE persona_external_records
      SET occurred_on = ?, content = ?, references_json = ?, importance = ?, updated_at = ?
      WHERE id = ? AND persona_id = ?
    `).run(
      record.occurredOn, record.content, JSON.stringify(record.references), record.importance,
      record.timestamp, record.id, record.personaId,
    ).changes === 1
    if (changed) {
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'persona_external_record_updated',
        targetType: 'persona_external_record', targetId: record.id, timestamp: record.timestamp,
      })
    }
    return changed
  }

  /** @param personaId 人物 UUID。 @param ids 第三方记录 UUID。 @param isEnabled 新状态。 @param timestamp 更新时间。 @returns 已核对并更新的记录数。 */
  async updatePersonaExternalRecordStates(personaId: string, ids: string[], isEnabled: boolean, timestamp: number): Promise<number> {
    return this.updateScopedEnabledState({
      table: 'persona_external_records', scopeColumn: 'persona_id', idColumn: 'id', scopeId: personaId,
      ids, isEnabled, timestamp,
    })
  }

  /** @param personaId 人物 UUID。 @param ids 第三方记录 UUID。 @param timestamp 删除时间。 @returns 全部归属正确时返回删除数，否则返回零。 */
  async deletePersonaExternalRecords(personaId: string, ids: string[], timestamp: number): Promise<number> {
    return this.client.transaction(() => {
      const placeholders = createPlaceholders(ids)
      const available = this.client.prepare(`
        SELECT COUNT(*) AS count FROM persona_external_records
        WHERE persona_id = ? AND id IN (${placeholders})
      `).get(personaId, ...ids) as { count: number }
      if (Number(available.count) !== ids.length) return 0
      this.client.prepare(`
        UPDATE analysis_batch_inputs SET source_available = 0
        WHERE input_type = 'persona_external_record' AND input_id IN (${placeholders})
      `).run(...ids)
      const changes = this.client.prepare(`
        DELETE FROM persona_external_records WHERE persona_id = ? AND id IN (${placeholders})
      `).run(personaId, ...ids).changes
      for (const id of ids) {
        insertAuditEvent(this.client, {
          actor: 'administrator', action: 'persona_external_record_deleted',
          targetType: 'persona_external_record', targetId: id, timestamp,
        })
      }
      return changes
    }).immediate()
  }

  /** @param personaId 人物 UUID。 @returns 当前启用的 OpenViking 派生记忆分析素材。 */
  async listOpenVikingDerivedMemories(personaId: string): Promise<OpenVikingDerivedMemoryView[]> {
    return this.client.prepare(`
      SELECT id, memory_type, content, content_hash, updated_at
      FROM openviking_derived_memories
      WHERE persona_id = ? AND is_enabled = 1
      ORDER BY updated_at DESC, id DESC
    `).all(personaId).map((value) => {
      const row = value as Record<string, unknown>
      return {
        id: String(row.id), memoryType: String(row.memory_type), content: String(row.content),
        contentHash: String(row.content_hash), updatedAt: Number(row.updated_at),
      }
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
    table: 'world_sources' | 'persona_feedback_sources' | 'persona_operation_records' | 'persona_external_records' | 'growth_materials'
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
   * 插入一份已经完成对象范围和来源校验的成长素材。
   * @param record 素材固定正文、来源、评分和所属对象。
   * @returns 插入完成时结束。
   */
  private insertGrowthMaterial(record: SaveGrowthMaterialRecord): void {
    const worldId = record.subjectType === 'world' ? record.subjectId : null
    const personaId = record.subjectType === 'persona' ? record.subjectId : null
    this.client.prepare(`
      INSERT INTO growth_materials (
        id, subject_type, world_id, persona_id, title, content_snapshot, content_hash,
        source_type, source_id, source_hash, importance, is_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      record.id, record.subjectType, worldId, personaId, record.title, record.content,
      hashContent(record.content), record.sourceType, record.sourceId, record.sourceHash,
      record.importance, record.timestamp, record.timestamp,
    )
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
   * 在调用方事务中写入一条成长、第一版修订、证据快照和审计事件。
   * @param record 单条成长创建命令。
   * @returns 写入完成时结束；来源范围不一致时抛错并由外层事务回滚。
   */
  private insertGrowth(record: CreateGrowthRecord): void {
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
  }

  /**
   * 把上一版不可变证据快照复制到新的人工修订。
   * @param sourceRevisionId 上一版成长修订 UUID。
   * @param targetRevisionId 新成长修订 UUID。
   * @returns 全部证据使用新关系 UUID 复制完成时结束。
   */
  private copyGrowthEvidence(sourceRevisionId: string, targetRevisionId: string): void {
    const rows = this.client.prepare(`
      SELECT source_type, source_id, source_hash, source_title, relationship, source_available
      FROM growth_revision_evidence WHERE growth_revision_id = ?
    `).all(sourceRevisionId) as Array<Record<string, unknown>>
    const insert = this.client.prepare(`
      INSERT INTO growth_revision_evidence (
        id, growth_revision_id, source_type, source_id, source_hash,
        source_title, relationship, source_available
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const row of rows) {
      insert.run(
        randomUUID(), targetRevisionId, String(row.source_type), String(row.source_id),
        String(row.source_hash), String(row.source_title), String(row.relationship), Number(row.source_available),
      )
    }
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
    id: String(row.id), name: String(row.name), summary: content.slice(0, 240), content,
    contentHash: String(row.content_hash),
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

/**
 * 把成长素材数据库行转换为公开视图，并比较来源当前哈希与导入快照。
 * @param value 包含可空当前来源哈希的 SQLite 查询行。
 * @returns 带对象归属、评分、启用状态和来源同步状态的成长素材。
 */
function toGrowthMaterial(value: unknown): GrowthMaterialView {
  const row = value as Record<string, unknown>
  const subjectType = row.subject_type as 'world' | 'persona'
  const sourceType = row.source_type as GrowthMaterialView['sourceType']
  const currentSourceHash = nullableString(row.current_source_hash)
  const sourceState: GrowthMaterialView['sourceState'] = sourceType !== 'source_material'
    ? 'not_applicable'
    : currentSourceHash === null
      ? 'missing'
      : currentSourceHash === nullableString(row.source_hash) ? 'current' : 'changed'
  return {
    id: String(row.id), subjectType,
    subjectId: String(subjectType === 'world' ? row.world_id : row.persona_id),
    title: String(row.title), content: String(row.content_snapshot), contentHash: String(row.content_hash),
    sourceType, sourceId: nullableString(row.source_id), sourceState,
    importance: Number(row.importance), isEnabled: Number(row.is_enabled) === 1,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

/**
 * 把学习提示词草稿数据库行转换为公开视图。
 * @param value SQLite 草稿行。
 * @returns 不暴露内部提示词容器标识和正文哈希的草稿视图。
 */
function toLearningPromptDraft(value: unknown): LearningPromptDraftView {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id), baseVersionId: nullableString(row.base_version_id), promptText: String(row.prompt_text),
    sourceAnalysisBatchId: nullableString(row.source_analysis_batch_id),
    createdBy: row.created_by as LearningPromptDraftView['createdBy'],
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

/**
 * 把已发布学习提示词数据库行转换为不可变历史视图。
 * @param value SQLite 版本行。
 * @returns 包含版本链、来源和发布时间的提示词版本。
 */
function toLearningPromptVersion(value: unknown): LearningPromptVersionView {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id), versionNo: Number(row.version_no), parentVersionId: nullableString(row.parent_version_id),
    promptText: String(row.prompt_text), sourceAnalysisBatchId: nullableString(row.source_analysis_batch_id),
    changeSummary: String(row.change_summary), createdBy: row.created_by as LearningPromptVersionView['createdBy'],
    publishedAt: Number(row.published_at),
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
  const operationType = row.operation_type as PersonaOperationRecordView['operationType']
  const input = formatJsonSnapshot(row.input_json)
  const decision = formatJsonSnapshot(row.decision_json)
  const content = `任务输入：\n${input ?? '未保存任务输入'}\n\n结果摘要：\n${String(row.result_summary)}${decision ? `\n\n结构化决策：\n${decision}` : ''}`
  return {
    id: String(row.id), personaId: String(row.persona_id), runId: String(row.run_id),
    operationType, title: operationTypeLabel(operationType), content, contentHash: hashContent(content),
    resultSummary: String(row.result_summary), isEnabled: Number(row.is_enabled) === 1, importance: Number(row.importance),
    sessionRecordId: row.session_record_id === null ? null : String(row.session_record_id),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

/**
 * 把第三方经历数据库行转换为含稳定分析正文和哈希的公开视图。
 * @param value SQLite 第三方经历行。
 * @returns 可供界面管理并直接进入记忆分析的记录。
 */
function toExternalRecord(value: unknown): PersonaExternalRecordView {
  const row = value as Record<string, unknown>
  const references = JSON.parse(String(row.references_json)) as Array<{ name: string, address: string }>
  const occurredOn = String(row.occurred_on)
  const content = String(row.content)
  const analysisContent = formatExternalRecordContent(occurredOn, content, references)
  return {
    id: String(row.id), personaId: String(row.persona_id), occurredOn, content,
    analysisContent, contentHash: hashContent(analysisContent), references,
    isEnabled: Number(row.is_enabled) === 1, importance: Number(row.importance),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

/**
 * 生成包含发生日期、事情正文和全部参考地址的稳定记忆分析文本。
 * @param occurredOn 事件发生日期。
 * @param content 人物做过的事情。
 * @param references 第三方来源名称与地址。
 * @returns 可直接交给 AI 的完整文本。
 */
function formatExternalRecordContent(
  occurredOn: string,
  content: string,
  references: Array<{ name: string, address: string }>,
): string {
  const referenceText = references.length
    ? references.map(item => `- ${item.name}：${item.address}`).join('\n')
    : '- 未提供'
  return `发生日期：${occurredOn}\n\n做过的事情：\n${content}\n\n参考来源：\n${referenceText}`
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

/**
 * 把数据库中的 JSON 字符串转成适合 AI 阅读的稳定文本。
 * @param value 可空 JSON 字符串或普通值。
 * @returns 格式化 JSON；空值返回 null，损坏旧数据返回原字符串。
 */
function formatJsonSnapshot(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  }
  catch {
    return text
  }
}

/**
 * 返回历史任务素材的通俗标题。
 * @param type 人物处理记录的任务类型。
 * @returns 对应兴趣判断、图文创作或内容分析的中文名称。
 */
function operationTypeLabel(type: PersonaOperationRecordView['operationType']): string {
  return { interest_assessment: '兴趣判断任务', artifact_generation: '图文创作任务', content_analysis: '内容分析任务' }[type]
}

/**
 * 把 SQLite 可空字段安全转换为字符串。
 * @param value 数据库原始字段值。
 * @returns null 或字符串化后的值。
 */
function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

/** @param content 规范化正文。 @returns SHA-256 十六进制哈希。 */
function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}
