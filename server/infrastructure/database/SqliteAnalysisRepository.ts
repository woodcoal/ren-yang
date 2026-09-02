import { createHash, randomUUID } from 'node:crypto'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { proposedLearningContentSchema } from '../../../shared/schemas/analysis'
import { textModelParametersSchema } from '../../../shared/schemas/generation'
import { DEFAULT_GROWTH_SCOPE } from '../../../shared/schemas/learning'
import type { ModelIterationResult, ModelLearningPromptResult, ReviewIterationProposalsInput } from '../../../shared/schemas/analysis'
import type { ListAnalysisBatchesInput } from '../../../shared/schemas/analysis'
import type {
  AnalysisBatchInputView,
  AnalysisBatchView,
  AnalysisType,
  IterationProposalView,
  ProposedLearningContentView,
} from '../../../shared/types/analysis'
import type {
  AnalysisBatchRuntimeRecord,
  AnalysisRepository,
  CreateAnalysisBatchRecord,
} from '../../ports/AnalysisRepository'
import type { TextModelSnapshot } from '../../domain/generation/GenerationModels'
import type { AiAlgorithmSnapshot } from '../../domain/ai/AiAlgorithmModels'
import { insertAuditEvent } from './AuditSql'

/** 使用 SQLite 短事务保存分析批次、AI 提案和人工审核应用结果。 */
export class SqliteAnalysisRepository implements AnalysisRepository {
  /**
   * 创建分析事实仓储。
   * @param client 已完成迁移的 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @param record 完整批次命令。 @returns 创建成功时为 true；同对象同类型已有排队或运行批次时为 false。 */
  async createBatch(record: CreateAnalysisBatchRecord): Promise<boolean> {
    return this.client.transaction(() => {
      const worldId = record.analysisType === 'world_growth' ? record.subjectId : null
      const personaId = record.analysisType === 'world_growth' ? null : record.subjectId
      const subjectColumn = record.analysisType === 'world_growth' ? 'world_id' : 'persona_id'
      const pending = this.client.prepare(`
        SELECT 1 FROM analysis_batches
        WHERE analysis_type = ? AND ${subjectColumn} = ? AND status IN ('queued', 'running')
        LIMIT 1
      `).get(record.analysisType, record.subjectId)
      if (pending) return false
      this.client.prepare(`
        INSERT INTO analysis_batches (
          id, analysis_type, world_id, persona_id, mode, baseline_soul_version_id,
          baseline_learning_prompt_version_id, baseline_learning_prompt_hash,
          baseline_json, model_snapshot_json, parameter_snapshot_json, prompt_version,
          algorithm_snapshot_json, auto_publish, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
      `).run(
        record.id, record.analysisType, worldId, personaId, record.mode, record.baselineSoulVersionId,
        record.baselineLearningPromptVersionId, record.baselineLearningPromptHash,
        JSON.stringify(record.baseline), JSON.stringify(record.model), JSON.stringify(record.parameters),
        record.promptVersion, record.algorithmSnapshot ? JSON.stringify(record.algorithmSnapshot) : null,
        record.autoPublish ? 1 : 0, record.timestamp, record.timestamp,
      )
      const insertInput = this.client.prepare(`
        INSERT INTO analysis_batch_inputs (
          id, batch_id, input_type, input_id, content_hash, title,
          content_snapshot, importance, is_new, source_available, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `)
      for (const input of record.inputs) {
        insertInput.run(
          input.id, record.id, input.inputType, input.inputId, input.contentHash,
          input.title, input.content, input.importance, input.isNew ? 1 : 0, record.timestamp,
        )
      }
      this.client.prepare(`
        INSERT INTO task_jobs (
          id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at
        ) VALUES (?, NULL, 'analyze_learning', ?, 'queued', 0, 2, ?, ?)
      `).run(record.taskId, JSON.stringify({ batchId: record.id }), record.timestamp, record.timestamp)
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'analysis_batch_created',
        targetType: 'analysis_batch', targetId: record.id, timestamp: record.timestamp,
      })
      return true
    }).immediate()
  }

  /** @param filter 可选分析类型、对象、状态和上限。 @returns 新批次在前的分析记录。 */
  async listBatches(filter: ListAnalysisBatchesInput): Promise<AnalysisBatchView[]> {
    const clauses: string[] = []
    const parameters: unknown[] = []
    if (filter.analysisType) {
      clauses.push('analysis_type = ?')
      parameters.push(filter.analysisType)
    }
    if (filter.subjectId) {
      clauses.push('(world_id = ? OR persona_id = ?)')
      parameters.push(filter.subjectId, filter.subjectId)
    }
    if (filter.status) {
      clauses.push('status = ?')
      parameters.push(filter.status)
    }
    parameters.push(filter.limit)
    return this.client.prepare(`
      SELECT * FROM analysis_batches
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(...parameters).map(row => this.toBatchView(row))
  }

  /** @param analysisType 分析类型。 @param subjectId 对象 UUID。 @returns 最新批次或 null。 */
  async findLatestBatch(analysisType: AnalysisType, subjectId: string): Promise<AnalysisBatchView | null> {
    const column = analysisType === 'world_growth' ? 'world_id' : 'persona_id'
    const row = this.client.prepare(`
      SELECT id FROM analysis_batches WHERE analysis_type = ? AND ${column} = ?
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(analysisType, subjectId) as { id: string } | undefined
    return row ? await this.findBatch(row.id) : null
  }

  /** @param analysisType 分析类型。 @param subjectId 对象 UUID。 @returns 已成功分析的“类型、标识、内容哈希”稳定键。 */
  async listAnalyzedInputKeys(analysisType: AnalysisType, subjectId: string): Promise<string[]> {
    const column = analysisType === 'world_growth' ? 'world_id' : 'persona_id'
    return (this.client.prepare(`
      SELECT DISTINCT analysis_batch_inputs.input_type || ':' || analysis_batch_inputs.input_id || ':' || analysis_batch_inputs.content_hash || ':' || analysis_batch_inputs.importance AS input_key
      FROM analysis_batch_inputs
      INNER JOIN analysis_batches ON analysis_batches.id = analysis_batch_inputs.batch_id
      WHERE analysis_batches.analysis_type = ? AND analysis_batches.${column} = ?
        AND analysis_batches.status IN ('awaiting_review', 'completed')
      ORDER BY input_key
    `).all(analysisType, subjectId) as Array<{ input_key: string }>).map(item => item.input_key)
  }

  /** @param batchId 批次 UUID。 @returns 完整批次或 null。 */
  async findBatch(batchId: string): Promise<AnalysisBatchView | null> {
    const row = this.client.prepare('SELECT * FROM analysis_batches WHERE id = ?').get(batchId)
    if (!row) return null
    return this.toBatchView(row)
  }

  /** @param batchId 批次 UUID。 @param timestamp 开始时间。 @returns 固定运行数据或 null。 */
  async startBatch(batchId: string, timestamp: number): Promise<AnalysisBatchRuntimeRecord | null> {
    return this.client.transaction(() => {
      const changed = this.client.prepare(`
        UPDATE analysis_batches SET status = 'running', error_code = NULL, error_message = NULL, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `).run(timestamp, batchId)
      if (changed.changes !== 1) return null
      const row = this.client.prepare('SELECT * FROM analysis_batches WHERE id = ?').get(batchId) as Record<string, unknown>
      return {
        batch: this.toBatchView(row),
        baseline: JSON.parse(String(row.baseline_json)) as unknown[],
        baselineLearningPromptVersionId: nullableString(row.baseline_learning_prompt_version_id),
        baselineLearningPromptHash: nullableString(row.baseline_learning_prompt_hash),
        model: JSON.parse(String(row.model_snapshot_json)) as TextModelSnapshot,
        parameters: textModelParametersSchema.parse(JSON.parse(String(row.parameter_snapshot_json))),
        promptVersion: String(row.prompt_version),
        algorithmSnapshot: row.algorithm_snapshot_json
          ? JSON.parse(String(row.algorithm_snapshot_json)) as AiAlgorithmSnapshot
          : null,
        autoPublish: Number(row.auto_publish) === 1,
      }
    }).immediate()
  }

  /** @param batchId 批次 UUID。 @param result 已校验模型结果。 @param timestamp 完成时间。 @returns 是否保存成功。 */
  async saveAnalysisResult(batchId: string, result: ModelIterationResult, timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const batch = this.client.prepare(`
        SELECT baseline_json FROM analysis_batches WHERE id = ? AND status = 'running'
      `).get(batchId) as { baseline_json: string } | undefined
      if (!batch) return false
      const baseline = JSON.parse(batch.baseline_json) as Array<Record<string, unknown>>
      const validInputIds = new Set((this.client.prepare(`
        SELECT id FROM analysis_batch_inputs WHERE batch_id = ?
      `).all(batchId) as Array<{ id: string }>).map(item => item.id))
      const insert = this.client.prepare(`
        INSERT INTO iteration_proposals (
          id, analysis_batch_id, operation, target_type, target_ids_json, before_json,
          proposed_json, evidence_input_ids_json, conflicts_json, rationale, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `)
      for (const proposal of result.proposals) {
        if (proposal.evidenceInputIds.some(id => !validInputIds.has(id))) throw new Error('分析提案引用了不存在的批次输入')
        const before = proposal.targetIds.map(id => baseline.find(item => item.id === id)).filter(Boolean)
        if (before.length !== proposal.targetIds.length) throw new Error('分析提案引用了不存在的基线记录')
        insert.run(
          randomUUID(), batchId, proposal.operation, proposal.targetType,
          JSON.stringify(proposal.targetIds), JSON.stringify(before),
          proposal.proposed ? JSON.stringify(proposal.proposed) : null,
          JSON.stringify(proposal.evidenceInputIds), JSON.stringify(proposal.conflicts),
          proposal.rationale, timestamp,
        )
      }
      this.client.prepare(`
        UPDATE analysis_batches SET raw_result_json = ?, status = 'awaiting_review',
          completed_at = ?, updated_at = ? WHERE id = ? AND status = 'running'
      `).run(JSON.stringify(result), timestamp, timestamp, batchId)
      return true
    }).immediate()
  }

  /** @param batchId 批次 UUID。 @param extraction 模型原始提取结果。 @param validatedFacts 程序校验后的事实。 @param timestamp 保存时间。 @returns 批次仍在运行时为 true。 */
  async saveExtractionSnapshot(batchId: string, extraction: unknown, validatedFacts: unknown[], timestamp: number): Promise<boolean> {
    return this.client.prepare(`
      UPDATE analysis_batches
      SET extraction_result_json = ?, validated_facts_json = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(JSON.stringify(extraction), JSON.stringify(validatedFacts), timestamp, batchId).changes === 1
  }

  /** @param batchId 批次 UUID。 @param summary 无变化说明。 @param timestamp 完成时间。 @returns 批次仍在运行并完成时为 true。 */
  async completeWithoutChanges(batchId: string, summary: string, timestamp: number): Promise<boolean> {
    return this.client.prepare(`
      UPDATE analysis_batches
      SET raw_result_json = ?, status = 'completed', completed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(JSON.stringify({ summary }), timestamp, timestamp, batchId).changes === 1
  }

  /**
   * 原子完成分析批次，并把 AI 返回的完整提示词保存为不生效草稿。
   * @param batchId 正在运行的分析批次 UUID。
   * @param result 已通过共享 Schema 校验的完整提示词和摘要。
   * @param promptId 当前对象尚无提示词容器时使用的 UUID。
   * @param draftId 当前对象尚无草稿时使用的 UUID。
   * @param timestamp 分析完成和草稿更新时间。
   * @param publication 存在时在同一事务内直接创建并启用不可变版本。
   * @returns 保存结果；基线或草稿变化时返回冲突。
   */
  async saveLearningPromptResult(
    batchId: string,
    result: ModelLearningPromptResult,
    promptId: string,
    draftId: string,
    timestamp: number,
    publication?: { versionId: string, changeSummary: string },
  ): Promise<'saved' | 'batch_changed' | 'version_conflict'> {
    return this.client.transaction(() => {
      const batch = this.client.prepare(`
        SELECT * FROM analysis_batches WHERE id = ? AND status = 'running'
      `).get(batchId) as Record<string, unknown> | undefined
      if (!batch) return 'batch_changed' as const
      const promptType = String(batch.analysis_type) as AnalysisType
      const worldId = promptType === 'world_growth' ? String(batch.world_id) : null
      const personaId = promptType === 'world_growth' ? null : String(batch.persona_id)
      const scopeColumn = promptType === 'world_growth' ? 'world_id' : 'persona_id'
      const subjectId = promptType === 'world_growth' ? worldId! : personaId!
      const existingPrompt = this.client.prepare(`
        SELECT id, active_version_id FROM learning_prompts
        WHERE prompt_type = ? AND ${scopeColumn} = ?
      `).get(promptType, subjectId) as { id: string, active_version_id: string | null } | undefined
      const baselineVersionId = nullableString(batch.baseline_learning_prompt_version_id)
      const currentVersionId = existingPrompt?.active_version_id ?? null
      if (currentVersionId !== baselineVersionId) return 'version_conflict' as const
      if (currentVersionId) {
        const currentVersion = this.client.prepare(`
          SELECT content_hash FROM learning_prompt_versions WHERE id = ?
        `).get(currentVersionId) as { content_hash: string } | undefined
        if (!currentVersion || currentVersion.content_hash !== nullableString(batch.baseline_learning_prompt_hash)) {
          return 'version_conflict' as const
        }
      }
      if (existingPrompt) {
        const draft = this.client.prepare(`SELECT 1 FROM learning_prompt_drafts WHERE prompt_id = ?`).get(existingPrompt.id)
        if (draft) return 'version_conflict' as const
      }
      this.client.prepare(`
        INSERT OR IGNORE INTO learning_prompts (
          id, prompt_type, world_id, persona_id, active_version_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?)
      `).run(promptId, promptType, worldId, personaId, timestamp, timestamp)
      const prompt = this.client.prepare(`
        SELECT id, active_version_id FROM learning_prompts
        WHERE prompt_type = ? AND ${scopeColumn} = ?
      `).get(promptType, subjectId) as { id: string, active_version_id: string | null }
      this.client.prepare(`
        INSERT INTO learning_prompt_drafts (
          id, prompt_id, base_version_id, prompt_text, content_hash,
          source_analysis_batch_id, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'analysis', ?, ?)
      `).run(
        draftId, prompt.id, prompt.active_version_id, result.promptText, hashContent(result.promptText),
        batchId, timestamp, timestamp,
      )
      if (publication) {
        const versionNo = Number((this.client.prepare(`
          SELECT COALESCE(MAX(version_no), 0) + 1 AS value
          FROM learning_prompt_versions WHERE prompt_id = ?
        `).get(prompt.id) as { value: number }).value)
        this.client.prepare(`
          INSERT INTO learning_prompt_versions (
            id, prompt_id, version_no, parent_version_id, prompt_text, content_hash,
            source_analysis_batch_id, change_summary, created_by, published_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'analysis', ?)
        `).run(
          publication.versionId, prompt.id, versionNo, prompt.active_version_id,
          result.promptText, hashContent(result.promptText), batchId, publication.changeSummary, timestamp,
        )
        this.client.prepare(`
          UPDATE learning_prompts SET active_version_id = ?, updated_at = ? WHERE id = ?
        `).run(publication.versionId, timestamp, prompt.id)
        this.client.prepare('DELETE FROM learning_prompt_drafts WHERE prompt_id = ?').run(prompt.id)
      }
      this.client.prepare(`UPDATE learning_prompts SET updated_at = ? WHERE id = ?`).run(timestamp, prompt.id)
      this.client.prepare(`
        UPDATE analysis_batches SET raw_result_json = ?, status = 'completed',
          completed_at = ?, updated_at = ? WHERE id = ? AND status = 'running'
      `).run(JSON.stringify(result), timestamp, timestamp, batchId)
      insertAuditEvent(this.client, {
        actor: publication ? 'system' : 'administrator',
        action: publication ? 'learning_prompt_automatically_published' : 'learning_prompt_draft_generated',
        targetType: 'analysis_batch', targetId: batchId, timestamp,
        details: { promptType, autoPublished: Boolean(publication) },
      })
      return 'saved' as const
    }).immediate()
  }

  /** @param batchId 批次 UUID。 @param code 稳定错误码。 @param message 脱敏错误。 @param timestamp 失败时间。 @returns 无返回值。 */
  async failBatch(batchId: string, code: string, message: string, timestamp: number): Promise<void> {
    this.client.prepare(`
      UPDATE analysis_batches SET status = 'failed', error_code = ?, error_message = ?,
        completed_at = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')
    `).run(code, message.slice(0, 1000), timestamp, timestamp, batchId)
  }

  /** @param batchId 批次 UUID。 @param input 审核决定。 @param timestamp 审核时间。 @returns 审核并应用后的批次或 null。 */
  async reviewAndApply(batchId: string, input: ReviewIterationProposalsInput, timestamp: number): Promise<AnalysisBatchView | null> {
    const applied = this.client.transaction(() => {
      const batch = this.client.prepare(`
        SELECT * FROM analysis_batches WHERE id = ? AND status IN ('awaiting_review', 'completed')
      `).get(batchId) as Record<string, unknown> | undefined
      if (!batch) return false
      const decisionIds = [...new Set(input.decisions.map(item => item.proposalId))]
      if (decisionIds.length !== input.decisions.length) return false
      const placeholders = decisionIds.map(() => '?').join(', ')
      const proposalRows = this.client.prepare(`
        SELECT * FROM iteration_proposals
        WHERE analysis_batch_id = ? AND id IN (${placeholders}) AND status = 'pending'
      `).all(batchId, ...decisionIds) as Array<Record<string, unknown>>
      if (proposalRows.length !== decisionIds.length) return false
      const proposalMap = new Map(proposalRows.map(row => [String(row.id), row]))
      for (const decision of input.decisions) {
        const proposal = proposalMap.get(decision.proposalId)!
        if (decision.action === 'reject') {
          this.client.prepare(`
            UPDATE iteration_proposals SET status = 'rejected', review_reason = ?, reviewed_at = ? WHERE id = ?
          `).run(decision.reason ?? null, timestamp, decision.proposalId)
          continue
        }
        const proposed = decision.reviewed === undefined
          ? parseOptionalProposed(proposal.proposed_json)
          : decision.reviewed
        this.applyAcceptedProposal(batch, proposal, proposed, timestamp)
        this.client.prepare(`
          UPDATE iteration_proposals SET status = 'applied', reviewed_json = ?, review_reason = ?, reviewed_at = ? WHERE id = ?
        `).run(proposed ? JSON.stringify(proposed) : null, decision.reason ?? null, timestamp, decision.proposalId)
      }
      const pending = this.client.prepare(`
        SELECT COUNT(*) AS count FROM iteration_proposals WHERE analysis_batch_id = ? AND status = 'pending'
      `).get(batchId) as { count: number }
      if (Number(pending.count) === 0) {
        this.client.prepare(`UPDATE analysis_batches SET status = 'completed', updated_at = ? WHERE id = ?`).run(timestamp, batchId)
      }
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'analysis_proposals_reviewed',
        targetType: 'analysis_batch', targetId: batchId, timestamp,
        details: { count: input.decisions.length },
      })
      return true
    }).immediate()
    return applied ? await this.findBatch(batchId) : null
  }

  /**
   * 在审核事务内应用单项已接受提案。
   * @param batch 分析批次行。
   * @param proposal 提案行。
   * @param proposed 管理员最终确认内容。
   * @param timestamp 审核时间。
   * @returns 无返回值。
   */
  private applyAcceptedProposal(
    batch: Record<string, unknown>,
    proposal: Record<string, unknown>,
    proposed: ProposedLearningContentView | null,
    timestamp: number,
  ): void {
    const operation = String(proposal.operation) as IterationProposalView['operation']
    const targetType = String(proposal.target_type) as 'growth' | 'memory'
    const targetIds = JSON.parse(String(proposal.target_ids_json)) as string[]
    if (operation === 'no_change') return
    if (operation === 'archive') {
      if (targetIds.length === 0) throw new Error('停用提案没有目标')
      this.archiveTargets(batch, targetType, targetIds, timestamp)
      return
    }
    if (!proposed) throw new Error('已接受提案缺少最终内容')
    if (operation === 'revise') {
      if (targetIds.length !== 1) throw new Error('修订提案必须只有一个目标')
      this.reviseTarget(batch, targetType, targetIds[0]!, proposed, proposal, timestamp)
      return
    }
    const newId = this.createActiveRecord(batch, targetType, proposed, proposal, timestamp)
    if (operation === 'merge' || operation === 'supersede') {
      if (targetIds.length === 0) throw new Error('合并或取代提案没有目标')
      this.supersedeTargets(batch, targetType, targetIds, newId, timestamp)
    }
  }

  /** @param batch 批次行。 @param targetType 目标类型。 @param targetIds 目标 UUID。 @param timestamp 更新时间。 @returns 无返回值。 */
  private archiveTargets(batch: Record<string, unknown>, targetType: 'growth' | 'memory', targetIds: string[], timestamp: number): void {
    const table = targetType === 'growth' ? 'growth_records' : 'memory_records'
    const scope = this.scopeCondition(batch, targetType)
    const placeholders = targetIds.map(() => '?').join(', ')
    const changed = this.client.prepare(`
      UPDATE ${table} SET status = 'archived', updated_at = ?
      WHERE ${scope.column} = ? AND id IN (${placeholders}) AND status IN ('active', 'archived')
    `).run(timestamp, scope.id, ...targetIds)
    if (changed.changes !== targetIds.length) throw new Error('停用提案目标已变化')
  }

  /** @param batch 批次行。 @param targetType 目标类型。 @param targetId 目标 UUID。 @param proposed 最终内容。 @param proposal 提案行。 @param timestamp 更新时间。 @returns 无返回值。 */
  private reviseTarget(batch: Record<string, unknown>, targetType: 'growth' | 'memory', targetId: string, proposed: ProposedLearningContentView, proposal: Record<string, unknown>, timestamp: number): void {
    const table = targetType === 'growth' ? 'growth_records' : 'memory_records'
    const revisionTable = targetType === 'growth' ? 'growth_revisions' : 'memory_revisions'
    const foreignColumn = targetType === 'growth' ? 'growth_id' : 'memory_id'
    const scope = this.scopeCondition(batch, targetType)
    const target = this.client.prepare(`SELECT id FROM ${table} WHERE id = ? AND ${scope.column} = ? AND status IN ('active', 'archived')`).get(targetId, scope.id)
    if (!target) throw new Error('修订提案目标已变化')
    const revisionNo = Number((this.client.prepare(`SELECT COALESCE(MAX(revision_no), 0) + 1 AS value FROM ${revisionTable} WHERE ${foreignColumn} = ?`).get(targetId) as { value: number }).value)
    const revisionId = randomUUID()
    if (targetType === 'growth') this.insertGrowthRevision(targetId, revisionId, revisionNo, proposed, String(batch.id), timestamp)
    else this.insertMemoryRevision(targetId, revisionId, revisionNo, proposed, String(batch.id), proposal, timestamp)
    this.insertProposalEvidence(targetType, revisionId, proposal)
    this.client.prepare(`UPDATE ${table} SET current_revision_id = ?, status = 'active', updated_at = ? WHERE id = ?`).run(revisionId, timestamp, targetId)
  }

  /** @param batch 批次行。 @param targetType 目标类型。 @param proposed 最终内容。 @param proposal 提案行。 @param timestamp 创建时间。 @returns 新记录 UUID。 */
  private createActiveRecord(batch: Record<string, unknown>, targetType: 'growth' | 'memory', proposed: ProposedLearningContentView, proposal: Record<string, unknown>, timestamp: number): string {
    const id = randomUUID()
    const revisionId = randomUUID()
    if (targetType === 'growth') {
      const subjectType = String(batch.analysis_type) === 'world_growth' ? 'world' : 'persona'
      const worldId = subjectType === 'world' ? String(batch.world_id) : null
      const personaId = subjectType === 'persona' ? String(batch.persona_id) : null
      this.client.prepare(`
        INSERT INTO growth_records (id, subject_type, world_id, persona_id, current_revision_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'candidate', ?, ?)
      `).run(id, subjectType, worldId, personaId, revisionId, timestamp, timestamp)
      this.insertGrowthRevision(id, revisionId, 1, proposed, String(batch.id), timestamp)
    }
    else {
      this.client.prepare(`
        INSERT INTO memory_records (id, persona_id, current_revision_id, memory_type, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'candidate', ?, ?)
      `).run(id, String(batch.persona_id), revisionId, proposed.memoryType ?? 'experience', timestamp, timestamp)
      this.insertMemoryRevision(id, revisionId, 1, proposed, String(batch.id), proposal, timestamp)
    }
    this.insertProposalEvidence(targetType, revisionId, proposal)
    // 先保存不可变修订和证据，再激活逻辑记录，确保 FTS 触发器能读取完整当前修订。
    const table = targetType === 'growth' ? 'growth_records' : 'memory_records'
    this.client.prepare(`UPDATE ${table} SET status = 'active', updated_at = ? WHERE id = ?`).run(timestamp, id)
    return id
  }

  /** @param batch 批次行。 @param targetType 目标类型。 @param targetIds 被取代 UUID。 @param replacementId 新记录 UUID。 @param timestamp 更新时间。 @returns 无返回值。 */
  private supersedeTargets(batch: Record<string, unknown>, targetType: 'growth' | 'memory', targetIds: string[], replacementId: string, timestamp: number): void {
    const table = targetType === 'growth' ? 'growth_records' : 'memory_records'
    const scope = this.scopeCondition(batch, targetType)
    const placeholders = targetIds.map(() => '?').join(', ')
    const changed = this.client.prepare(`
      UPDATE ${table} SET status = 'superseded', superseded_by_id = ?, updated_at = ?
      WHERE ${scope.column} = ? AND id IN (${placeholders}) AND status IN ('active', 'archived')
    `).run(replacementId, timestamp, scope.id, ...targetIds)
    if (changed.changes !== targetIds.length) throw new Error('取代提案目标已变化')
  }

  /** @param growthId 成长 UUID。 @param revisionId 修订 UUID。 @param revisionNo 修订号。 @param proposed 最终内容。 @param batchId 批次 UUID。 @param timestamp 创建时间。 @returns 无返回值。 */
  private insertGrowthRevision(growthId: string, revisionId: string, revisionNo: number, proposed: ProposedLearningContentView, batchId: string, timestamp: number): void {
    this.client.prepare(`
      INSERT INTO growth_revisions (
        id, growth_id, revision_no, content, content_hash, scope, importance,
        analysis_batch_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'analysis', ?)
    `).run(revisionId, growthId, revisionNo, proposed.content, hashContent(proposed.content), DEFAULT_GROWTH_SCOPE, proposed.importance, batchId, timestamp)
  }

  /** @param memoryId 记忆 UUID。 @param revisionId 修订 UUID。 @param revisionNo 修订号。 @param proposed 最终内容。 @param batchId 批次 UUID。 @param proposal 提案行。 @param timestamp 创建时间。 @returns 无返回值。 */
  private insertMemoryRevision(memoryId: string, revisionId: string, revisionNo: number, proposed: ProposedLearningContentView, batchId: string, proposal: Record<string, unknown>, timestamp: number): void {
    const inputIds = JSON.parse(String(proposal.evidence_input_ids_json)) as string[]
    const independent = Number((this.client.prepare(`
      SELECT COUNT(DISTINCT persona_operation_records.run_id) AS count
      FROM analysis_batch_inputs
      INNER JOIN persona_operation_records
        ON analysis_batch_inputs.input_type = 'persona_operation_record'
        AND persona_operation_records.id = analysis_batch_inputs.input_id
      WHERE analysis_batch_inputs.id IN (${inputIds.map(() => '?').join(', ')})
    `).get(...inputIds) as { count: number }).count)
    this.client.prepare(`
      INSERT INTO memory_revisions (
        id, memory_id, revision_no, content, content_hash, scope, importance,
        independent_evidence_count, analysis_batch_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'analysis', ?)
    `).run(revisionId, memoryId, revisionNo, proposed.content, hashContent(proposed.content), proposed.scope, proposed.importance, independent, batchId, timestamp)
  }

  /** @param targetType 目标类型。 @param revisionId 新修订 UUID。 @param proposal 提案行。 @returns 无返回值。 */
  private insertProposalEvidence(targetType: 'growth' | 'memory', revisionId: string, proposal: Record<string, unknown>): void {
    const inputIds = JSON.parse(String(proposal.evidence_input_ids_json)) as string[]
    if (inputIds.length === 0) return
    const placeholders = inputIds.map(() => '?').join(', ')
    const rows = this.client.prepare(`SELECT * FROM analysis_batch_inputs WHERE id IN (${placeholders})`).all(...inputIds) as Array<Record<string, unknown>>
    if (rows.length !== inputIds.length) throw new Error('提案证据输入已变化')
    if (targetType === 'growth') {
      const insert = this.client.prepare(`
        INSERT INTO growth_revision_evidence (
          id, growth_revision_id, source_type, source_id, source_hash,
          source_title, relationship, source_available
        ) VALUES (?, ?, ?, ?, ?, ?, 'supporting', ?)
      `)
      for (const row of rows) {
        if (!['world_source', 'persona_feedback_source'].includes(String(row.input_type))) continue
        insert.run(
          randomUUID(), revisionId, String(row.input_type), String(row.input_id), String(row.content_hash),
          String(row.title), Number(row.source_available),
        )
      }
      return
    }
    const insert = this.client.prepare(`
      INSERT INTO memory_revision_evidence (id, memory_revision_id, operation_record_id, run_id, relationship)
      VALUES (?, ?, ?, ?, 'supporting')
    `)
    for (const row of rows) {
      if (String(row.input_type) !== 'persona_operation_record') continue
      const operation = this.client.prepare(`SELECT run_id FROM persona_operation_records WHERE id = ?`).get(String(row.input_id)) as { run_id: string } | undefined
      if (operation) insert.run(randomUUID(), revisionId, String(row.input_id), operation.run_id)
    }
  }

  /** @param batch 批次行。 @param targetType 目标类型。 @returns 目标表的对象范围条件。 */
  private scopeCondition(batch: Record<string, unknown>, targetType: 'growth' | 'memory'): { column: 'world_id' | 'persona_id', id: string } {
    if (targetType === 'memory' || String(batch.analysis_type) !== 'world_growth') return { column: 'persona_id', id: String(batch.persona_id) }
    return { column: 'world_id', id: String(batch.world_id) }
  }

  /** @param value SQLite 批次行。 @returns 完整批次视图。 */
  private toBatchView(value: unknown): AnalysisBatchView {
    const row = value as Record<string, unknown>
    const analysisType = row.analysis_type as AnalysisType
    const inputs = this.client.prepare(`
      SELECT * FROM analysis_batch_inputs WHERE batch_id = ? ORDER BY created_at, id
    `).all(String(row.id)).map(toBatchInput)
    const proposals = this.client.prepare(`
      SELECT * FROM iteration_proposals WHERE analysis_batch_id = ? ORDER BY created_at, id
    `).all(String(row.id)).map(toProposal)
    return {
      id: String(row.id), analysisType,
      subjectId: String(analysisType === 'world_growth' ? row.world_id : row.persona_id),
      mode: row.mode as AnalysisBatchView['mode'], status: row.status as AnalysisBatchView['status'],
      baselineSoulVersionId: String(row.baseline_soul_version_id), inputs, proposals,
      resultSummary: readAnalysisSummary(row.raw_result_json),
      errorCode: nullableString(row.error_code), errorMessage: nullableString(row.error_message),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), completedAt: nullableNumber(row.completed_at),
    }
  }
}

/** @param value SQLite 输入行。 @returns 批次输入视图。 */
function toBatchInput(value: unknown): AnalysisBatchInputView {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id), inputType: row.input_type as AnalysisBatchInputView['inputType'], inputId: String(row.input_id),
    title: String(row.title), contentSnapshot: nullableString(row.content_snapshot), contentHash: String(row.content_hash),
    importance: Number(row.importance), isNew: Number(row.is_new) === 1, sourceAvailable: Number(row.source_available) === 1,
  }
}

/** @param value SQLite 提案行。 @returns 提案视图。 */
function toProposal(value: unknown): IterationProposalView {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id), operation: row.operation as IterationProposalView['operation'],
    targetType: row.target_type as IterationProposalView['targetType'],
    targetIds: JSON.parse(String(row.target_ids_json)) as string[],
    before: JSON.parse(String(row.before_json)) as IterationProposalView['before'],
    proposed: parseOptionalProposed(row.proposed_json), reviewed: parseOptionalProposed(row.reviewed_json),
    evidenceInputIds: JSON.parse(String(row.evidence_input_ids_json)) as string[],
    conflicts: JSON.parse(String(row.conflicts_json)) as string[], rationale: String(row.rationale),
    status: row.status as IterationProposalView['status'], reviewReason: nullableString(row.review_reason),
    reviewedAt: nullableNumber(row.reviewed_at), createdAt: Number(row.created_at),
  }
}

/** @param value 可空 JSON。 @returns 已校验长期内容或 null。 */
function parseOptionalProposed(value: unknown): ProposedLearningContentView | null {
  if (value === null || value === undefined) return null
  return proposedLearningContentSchema.parse(JSON.parse(String(value)))
}

/** @param value 可空值。 @returns 字符串或 null。 */
function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

/** @param value 可空值。 @returns 数字或 null。 */
function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

/**
 * 从新旧分析结果 JSON 中读取可展示摘要。
 * @param value 可空的分析原始结果 JSON。
 * @returns 新完整提示词结果的摘要；旧结果或无效 JSON 返回 null。
 */
function readAnalysisSummary(value: unknown): string | null {
  if (value === null || value === undefined) return null
  try {
    const parsed = JSON.parse(String(value)) as Record<string, unknown>
    return typeof parsed.summary === 'string' ? parsed.summary : null
  }
  catch {
    return null
  }
}

/** @param content 正文。 @returns SHA-256 十六进制哈希。 */
function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}
