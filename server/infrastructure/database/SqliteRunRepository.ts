import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import {
  documentSpecSchema,
  formatTemplateSpecSchema,
  interestAssessmentSchema,
  sceneContextSchema,
  textModelParametersSchema,
} from '../../../shared/schemas/generation'
import type {
  ArtifactBlockRecord,
  BlockAttemptRecord,
  DocumentSpecRecord,
  EvidenceSnapshotRecord,
  FormatTemplateRecord,
  GenerationRunRecord,
  ImageAssetRecord,
  InterestBatchRecord,
  ParameterProfileRecord,
  TextModelSnapshot,
  TextModelUsage,
} from '../../domain/generation/GenerationModels'
import type {
  CompleteInterestBatchItem,
  CreateInterestBatchCommand,
  CreateRunCommand,
  RunListFilter,
  RunPersonaIdentity,
  RunRepository,
  RunTaskRecord,
} from '../../ports/RunRepository'

/** 使用 SQLite 短事务实现阶段四全部运行和图文资产事实。 */
export class SqliteRunRepository implements RunRepository {
  /**
   * 创建运行仓储。
   * @param client 已完成迁移的 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @returns 名称和版本倒序的参数方案。 */
  async listParameterProfiles(): Promise<ParameterProfileRecord[]> {
    return this.client.prepare('SELECT * FROM parameter_profiles ORDER BY name, version DESC').all().map(toParameterProfile)
  }

  /** @param id 参数方案 UUID。 @returns 参数方案或 null。 */
  async findParameterProfile(id: string): Promise<ParameterProfileRecord | null> {
    const row = this.client.prepare('SELECT * FROM parameter_profiles WHERE id = ?').get(id)
    return row ? toParameterProfile(row) : null
  }

  /**
   * 原子计算同名下一版本并创建不可变参数方案。
   * @param id 新 UUID。
   * @param name 方案名称。
   * @param values 参数值。
   * @param timestamp 创建时间。
   * @returns 新参数方案版本。
   */
  async createParameterProfile(id: string, name: string, values: ParameterProfileRecord['values'], timestamp: number): Promise<ParameterProfileRecord> {
    return this.client.transaction(() => {
      const row = this.client.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM parameter_profiles WHERE name = ?').get(name) as { version: number }
      this.client.prepare(`
        INSERT INTO parameter_profiles (id, name, version, scope, values_json, is_active, created_at)
        VALUES (?, ?, ?, 'system', ?, 1, ?)
      `).run(id, name, row.version, JSON.stringify(values), timestamp)
      return { id, name, version: row.version, scope: 'system', values, isActive: true, createdAt: timestamp }
    }).immediate()
  }

  /** @returns 名称和版本倒序的格式模板。 */
  async listFormatTemplates(): Promise<FormatTemplateRecord[]> {
    return this.client.prepare('SELECT * FROM format_templates ORDER BY name, version DESC').all().map(toFormatTemplate)
  }

  /** @param id 模板 UUID。 @returns 格式模板或 null。 */
  async findFormatTemplate(id: string): Promise<FormatTemplateRecord | null> {
    const row = this.client.prepare('SELECT * FROM format_templates WHERE id = ?').get(id)
    return row ? toFormatTemplate(row) : null
  }

  /**
   * 原子计算同名下一版本并创建不可变格式模板。
   * @param id 新 UUID。
   * @param name 模板名称。
   * @param spec 模板规格。
   * @param timestamp 创建时间。
   * @returns 新格式模板版本。
   */
  async createFormatTemplate(id: string, name: string, spec: FormatTemplateRecord['spec'], timestamp: number): Promise<FormatTemplateRecord> {
    return this.client.transaction(() => {
      const row = this.client.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM format_templates WHERE name = ?').get(name) as { version: number }
      this.client.prepare(`
        INSERT INTO format_templates (id, name, version, spec_json, is_active, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(id, name, row.version, JSON.stringify(spec), timestamp)
      return { id, name, version: row.version, spec, isActive: true, createdAt: timestamp }
    }).immediate()
  }

  /**
   * 原子保存运行输入、证据快照和首个任务。
   * @param command 已完整解析的运行命令。
   * @returns 无返回值。
   */
  async createRun(command: CreateRunCommand): Promise<void> {
    this.client.transaction(() => {
      this.insertRunFacts(command)
      this.client.prepare(`
        INSERT INTO task_jobs (
          id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'queued', 0, 2, ?, ?)
      `).run(command.taskId, command.runId, command.taskType, JSON.stringify({ runId: command.runId }), command.timestamp, command.timestamp)
    }).immediate()
  }

  /**
   * 原子创建兴趣批次、全部独立运行与唯一批量任务。
   * @param command 已固定人物、算法、上下文和输入顺序的创建命令。
   * @returns 无返回值。
   */
  async createInterestBatch(command: CreateInterestBatchCommand): Promise<void> {
    this.client.transaction(() => {
      this.client.prepare(`
        INSERT INTO interest_batches (id, persona_id, usage_json, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?)
      `).run(command.batchId, command.personaId, command.timestamp, command.timestamp)
      const insertItem = this.client.prepare(`
        INSERT INTO interest_batch_items (batch_id, item_id, ordinal, run_id) VALUES (?, ?, ?, ?)
      `)
      for (const item of command.items) {
        this.insertRunFacts(item.run)
        insertItem.run(command.batchId, item.itemId, item.ordinal, item.run.runId)
      }
      const firstItem = command.items[0]
      if (!firstItem) throw new Error('兴趣批次至少需要一个条目')
      const anchorRunId = firstItem.run.runId
      this.client.prepare(`
        INSERT INTO task_jobs (
          id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at
        ) VALUES (?, ?, 'assess_interest', ?, 'queued', 0, 2, ?, ?)
      `).run(command.taskId, anchorRunId, JSON.stringify({ runId: anchorRunId, batchId: command.batchId }), command.timestamp, command.timestamp)
    }).immediate()
  }

  /**
   * 读取兴趣批次及其全部独立运行。
   * @param batchId 批次 UUID。
   * @returns 按输入序号排列的批次记录；不存在时返回 null。
   */
  async findInterestBatch(batchId: string): Promise<InterestBatchRecord | null> {
    const batch = this.client.prepare('SELECT * FROM interest_batches WHERE id = ?').get(batchId) as Record<string, unknown> | undefined
    if (!batch) return null
    const rows = this.client.prepare(`
      SELECT generation_runs.*, interest_batch_items.item_id, interest_batch_items.ordinal
      FROM interest_batch_items
      INNER JOIN generation_runs ON generation_runs.id = interest_batch_items.run_id
      WHERE interest_batch_items.batch_id = ?
      ORDER BY interest_batch_items.ordinal
    `).all(batchId) as Array<Record<string, unknown>>
    return {
      id: String(batch.id), personaId: String(batch.persona_id),
      usage: batch.usage_json === null ? null : JSON.parse(String(batch.usage_json)) as TextModelUsage,
      createdAt: Number(batch.created_at), updatedAt: Number(batch.updated_at),
      items: rows.map(value => ({ itemId: String(value.item_id), ordinal: Number(value.ordinal), run: toRun(value) })),
    }
  }

  /**
   * 查找独立兴趣运行在批次中的定位。
   * @param runId 独立兴趣运行 UUID。
   * @returns 所属批次和条目标识；不属于批次时返回 null。
   */
  async findInterestBatchItemByRun(runId: string): Promise<{ batchId: string, itemId: string } | null> {
    const value = this.client.prepare(`
      SELECT batch_id, item_id FROM interest_batch_items WHERE run_id = ?
    `).get(runId) as { batch_id: string, item_id: string } | undefined
    return value ? { batchId: value.batch_id, itemId: value.item_id } : null
  }

  /**
   * 将主调用的全部条目或手工重试的单个条目切换为运行中。
   * @param batchId 批次 UUID。
   * @param itemId 单项重试编号；主调用时为 null。
   * @param timestamp 更新时间。
   * @returns 实际开始的运行数量。
   */
  async startInterestBatch(batchId: string, itemId: string | null, timestamp: number): Promise<number> {
    const itemClause = itemId === null ? '' : 'AND interest_batch_items.item_id = ?'
    const parameters = itemId === null ? [timestamp, batchId] : [timestamp, batchId, itemId]
    return this.client.prepare(`
      UPDATE generation_runs SET status = 'running', error_code = NULL, error_message = NULL, updated_at = ?
      WHERE status = 'queued' AND id IN (
        SELECT run_id FROM interest_batch_items WHERE batch_id = ? ${itemClause}
      )
    `).run(...parameters).changes
  }

  /**
   * 在一个短事务中逐项保存成功或失败，并累计批次供应商用量。
   * @param batchId 批次 UUID。
   * @param items 本轮目标项的独立终态。
   * @param usage 本轮供应商用量。
   * @param timestamp 完成时间。
   * @returns 无返回值。
   */
  async completeInterestBatch(batchId: string, items: CompleteInterestBatchItem[], usage: TextModelUsage, timestamp: number): Promise<void> {
    this.client.transaction(() => {
      const updateSuccess = this.client.prepare(`
        UPDATE generation_runs SET status = 'succeeded', result_json = ?, usage_json = ?,
          error_code = NULL, error_message = NULL, completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `)
      const updateFailure = this.client.prepare(`
        UPDATE generation_runs SET status = 'failed', result_json = NULL, usage_json = ?,
          error_code = ?, error_message = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `)
      items.forEach((item, index) => {
        const currentRun = this.client.prepare('SELECT usage_json FROM generation_runs WHERE id = ?').get(item.runId) as { usage_json: string | null }
        const previousRunUsage = currentRun.usage_json === null ? null : JSON.parse(currentRun.usage_json) as TextModelUsage
        const itemUsage = index === 0 ? JSON.stringify(mergeUsage(previousRunUsage, usage)) : null
        if (item.result) updateSuccess.run(JSON.stringify(item.result), itemUsage, timestamp, timestamp, item.runId)
        else updateFailure.run(itemUsage, item.errorCode, item.errorMessage?.slice(0, 1000) ?? '模型没有返回该条目的有效结果', timestamp, timestamp, item.runId)
      })
      const current = this.client.prepare('SELECT usage_json FROM interest_batches WHERE id = ?').get(batchId) as { usage_json: string | null }
      const previous = current.usage_json === null ? null : JSON.parse(current.usage_json) as TextModelUsage
      const cumulative = mergeUsage(previous, usage)
      this.client.prepare('UPDATE interest_batches SET usage_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(cumulative), timestamp, batchId)
    }).immediate()
  }

  /**
   * 累加批次本轮已产生但未形成有效结果的供应商用量。
   * @param batchId 批次 UUID。
   * @param usage 本轮新增供应商用量。
   * @param timestamp 更新时间。
   * @returns 无返回值。
   */
  async saveInterestBatchUsage(batchId: string, usage: TextModelUsage, timestamp: number): Promise<void> {
    const current = this.client.prepare('SELECT usage_json FROM interest_batches WHERE id = ?').get(batchId) as { usage_json: string | null } | undefined
    if (!current) return
    const previous = current.usage_json === null ? null : JSON.parse(current.usage_json) as TextModelUsage
    this.client.prepare('UPDATE interest_batches SET usage_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(mergeUsage(previous, usage)), timestamp, batchId)
  }

  /**
   * 供应商临时失败后，将本轮运行条目恢复为同一任务可重试的排队状态。
   * @param batchId 批次 UUID。
   * @param itemId 单项重试编号；主调用时为 null。
   * @param timestamp 更新时间。
   * @returns 无返回值。
   */
  async prepareInterestBatchRetry(batchId: string, itemId: string | null, timestamp: number): Promise<void> {
    const itemClause = itemId === null ? '' : 'AND interest_batch_items.item_id = ?'
    const parameters = itemId === null ? [timestamp, batchId] : [timestamp, batchId, itemId]
    this.client.prepare(`
      UPDATE generation_runs SET status = 'queued', error_code = NULL, error_message = NULL,
        completed_at = NULL, updated_at = ?
      WHERE status = 'running' AND id IN (
        SELECT run_id FROM interest_batch_items WHERE batch_id = ? ${itemClause}
      )
    `).run(...parameters)
  }

  /**
   * 当批次外层结构或供应商调用最终失败时，终止全部待完成条目。
   * @param batchId 批次 UUID。
   * @param code 稳定错误码。
   * @param message 已脱敏错误原因。
   * @param timestamp 完成时间。
   * @returns 无返回值。
   */
  async failPendingInterestBatch(batchId: string, code: string, message: string, timestamp: number): Promise<void> {
    this.client.prepare(`
      UPDATE generation_runs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?, updated_at = ?
      WHERE status IN ('queued', 'running') AND id IN (
        SELECT run_id FROM interest_batch_items WHERE batch_id = ?
      )
    `).run(code, message.slice(0, 1000), timestamp, timestamp, batchId)
  }

  /**
   * 为一个失败条目原子建立新任务，不改变其他条目。
   * @param batchId 批次 UUID。
   * @param itemId 客户端稳定编号。
   * @param taskId 新任务 UUID。
   * @param timestamp 创建时间。
   * @returns 条目确实从失败状态进入重试时返回 true。
   */
  async retryInterestBatchItem(batchId: string, itemId: string, taskId: string, timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const target = this.client.prepare(`
        SELECT generation_runs.id FROM interest_batch_items
        INNER JOIN generation_runs ON generation_runs.id = interest_batch_items.run_id
        WHERE interest_batch_items.batch_id = ? AND interest_batch_items.item_id = ? AND generation_runs.status = 'failed'
      `).get(batchId, itemId) as { id: string } | undefined
      if (!target) return false
      this.client.prepare(`
        UPDATE generation_runs SET status = 'queued', result_json = NULL, error_code = NULL,
          error_message = NULL, completed_at = NULL, updated_at = ? WHERE id = ?
      `).run(timestamp, target.id)
      this.client.prepare(`
        INSERT INTO task_jobs (id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
        VALUES (?, ?, 'assess_interest', ?, 'queued', 0, 2, ?, ?)
      `).run(taskId, target.id, JSON.stringify({ runId: target.id, batchId, itemId }), timestamp, timestamp)
      this.client.prepare('UPDATE interest_batches SET updated_at = ? WHERE id = ?').run(timestamp, batchId)
      return true
    }).immediate()
  }

  /**
   * 插入一个运行及其证据事实，不创建任务；调用方必须位于事务中。
   * @param command 已固定的运行事实。
   * @returns 无返回值。
   */
  private insertRunFacts(command: Omit<CreateRunCommand, 'taskId' | 'taskType'> | CreateRunCommand): void {
    this.client.prepare(`
      INSERT INTO generation_runs (
        id, kind, persona_version_id, format_template_id, parameter_profile_id, status,
        input_json, scene_json, parameter_snapshot_json, model_snapshot_json, image_model_snapshot_json,
        prompt_version, context_provider, prompt_context_snapshot_json, algorithm_snapshot_json,
        interest_algorithm_snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      command.runId, command.kind, command.personaVersionId, command.formatTemplateId, command.parameterProfileId,
      command.status, JSON.stringify(command.input), command.scene ? JSON.stringify(command.scene) : null,
      JSON.stringify(command.parameters), JSON.stringify(command.model), command.imageModel ? JSON.stringify(command.imageModel) : null,
      command.promptVersion, command.contextProvider, JSON.stringify(command.promptContextSnapshot),
      command.algorithmSnapshot ? JSON.stringify(command.algorithmSnapshot) : null,
      command.interestAlgorithmSnapshot ? JSON.stringify(command.interestAlgorithmSnapshot) : null,
      command.timestamp, command.timestamp,
    )
    const insertEvidence = this.client.prepare(`
      INSERT INTO evidence_snapshots (
        id, run_id, source_id, chunk_id, role, content, content_hash, rank, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const evidence of command.evidence) {
      insertEvidence.run(
        evidence.id, command.runId, evidence.sourceId, evidence.chunkId, evidence.role,
        evidence.content, evidence.contentHash, evidence.rank, JSON.stringify(evidence.metadata), command.timestamp,
      )
    }
  }

  /** @param filter 可选人物、类型、状态和上限。 @returns 新运行在前的记录。 */
  async listRuns(filter: RunListFilter): Promise<GenerationRunRecord[]> {
    const clauses: string[] = []
    const parameters: unknown[] = []
    if (filter.personaId) {
      clauses.push('soul_versions.persona_id = ?')
      parameters.push(filter.personaId)
    }
    if (filter.kind) {
      clauses.push('generation_runs.kind = ?')
      parameters.push(filter.kind)
    }
    if (filter.status) {
      clauses.push('generation_runs.status = ?')
      parameters.push(filter.status)
    }
    parameters.push(filter.limit)
    return this.client.prepare(`
      SELECT generation_runs.* FROM generation_runs
      INNER JOIN soul_versions ON soul_versions.id = generation_runs.persona_version_id
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY generation_runs.created_at DESC, generation_runs.id DESC LIMIT ?
    `).all(...parameters).map(toRun)
  }

  /** @param id 运行 UUID。 @returns 运行或 null。 */
  async findRun(id: string): Promise<GenerationRunRecord | null> {
    const row = this.client.prepare('SELECT * FROM generation_runs WHERE id = ?').get(id)
    return row ? toRun(row) : null
  }

  /** @param runId 运行 UUID。 @returns 运行绑定人物身份或 null。 */
  async findRunPersona(runId: string): Promise<RunPersonaIdentity | null> {
    const row = this.client.prepare(`
      SELECT personas.id AS persona_id, personas.name AS persona_name
      FROM generation_runs
      INNER JOIN soul_versions ON soul_versions.id = generation_runs.persona_version_id
      INNER JOIN personas ON personas.id = soul_versions.persona_id
      WHERE generation_runs.id = ?
    `).get(runId) as Record<string, unknown> | undefined
    return row ? { personaId: String(row.persona_id), personaName: String(row.persona_name) } : null
  }

  /** @param runId 运行 UUID。 @returns 排名顺序的证据快照。 */
  async listEvidence(runId: string): Promise<EvidenceSnapshotRecord[]> {
    return this.client.prepare('SELECT * FROM evidence_snapshots WHERE run_id = ? ORDER BY rank, id').all(runId).map(toEvidence)
  }

  /** @param runId 运行 UUID。 @returns 新修订在前的规格历史。 */
  async listDocumentSpecs(runId: string): Promise<DocumentSpecRecord[]> {
    return this.client.prepare('SELECT * FROM document_specs WHERE run_id = ? ORDER BY revision DESC').all(runId).map(toDocumentSpec)
  }

  /** @param runId 运行 UUID。 @returns 顺序稳定的产物文字块。 */
  async listBlocks(runId: string): Promise<ArtifactBlockRecord[]> {
    return this.client.prepare(`
      SELECT artifact_blocks.* FROM artifact_blocks
      INNER JOIN artifact_documents ON artifact_documents.id = artifact_blocks.document_id
      WHERE artifact_documents.run_id = ? ORDER BY artifact_blocks.ordinal
    `).all(runId).map(toBlock)
  }

  /** @param blockId 块 UUID。 @returns 尝试号倒序的历史。 */
  async listBlockAttempts(blockId: string): Promise<BlockAttemptRecord[]> {
    return this.client.prepare('SELECT * FROM block_attempts WHERE block_id = ? ORDER BY attempt_no DESC').all(blockId).map(toAttempt)
  }

  /** @param runId 运行 UUID。 @returns 新任务在前的任务历史。 */
  async listRunTasks(runId: string): Promise<RunTaskRecord[]> {
    return this.client.prepare('SELECT * FROM task_jobs WHERE run_id = ? ORDER BY created_at DESC, id DESC').all(runId).map(toRunTask)
  }

  /** @param runId 运行 UUID。 @returns 已收到供应商响应的块尝试用量。 */
  async listRunTextUsages(runId: string): Promise<TextModelUsage[]> {
    return (this.client.prepare(`
      SELECT block_attempts.usage_json FROM block_attempts
      INNER JOIN artifact_blocks ON artifact_blocks.id = block_attempts.block_id
      INNER JOIN artifact_documents ON artifact_documents.id = artifact_blocks.document_id
      WHERE artifact_documents.run_id = ? AND block_attempts.usage_json IS NOT NULL
      ORDER BY block_attempts.created_at, block_attempts.id
    `).all(runId) as Array<{ usage_json: string }>).map(row => JSON.parse(row.usage_json) as TextModelUsage)
  }

  /** @param runId 运行 UUID。 @returns 按块顺序排列的成功图片资产。 */
  async listImageAssets(runId: string): Promise<ImageAssetRecord[]> {
    return this.client.prepare(`
      SELECT image_assets.* FROM image_assets
      INNER JOIN block_attempts ON block_attempts.id = image_assets.attempt_id
      INNER JOIN artifact_blocks ON artifact_blocks.id = block_attempts.block_id
      INNER JOIN artifact_documents ON artifact_documents.id = artifact_blocks.document_id
      WHERE artifact_documents.run_id = ? ORDER BY artifact_blocks.ordinal, image_assets.created_at
    `).all(runId).map(toImageAsset)
  }

  /** @param runId 运行 UUID。 @param assetId 资产 UUID。 @returns 确属该运行的资产或 null。 */
  async findImageAsset(runId: string, assetId: string): Promise<ImageAssetRecord | null> {
    const value = this.client.prepare(`
      SELECT image_assets.* FROM image_assets
      INNER JOIN block_attempts ON block_attempts.id = image_assets.attempt_id
      INNER JOIN artifact_blocks ON artifact_blocks.id = block_attempts.block_id
      INNER JOIN artifact_documents ON artifact_documents.id = artifact_blocks.document_id
      WHERE artifact_documents.run_id = ? AND image_assets.id = ?
    `).get(runId, assetId)
    return value ? toImageAsset(value) : null
  }

  /** @param runId 运行 UUID。 @param expected 合法起始状态。 @param timestamp 更新时间。 @returns 状态被切换时为 true。 */
  async markRunRunning(runId: string, expected: GenerationRunRecord['status'][], timestamp: number): Promise<boolean> {
    if (expected.length === 0) return false
    const placeholders = expected.map(() => '?').join(', ')
    return this.client.prepare(`
      UPDATE generation_runs SET status = 'running', error_code = NULL, error_message = NULL, updated_at = ?
      WHERE id = ? AND status IN (${placeholders})
    `).run(timestamp, runId, ...expected).changes === 1
  }

  /** @param runId 运行 UUID。 @param result 兴趣结果。 @param usage 用量。 @param timestamp 完成时间。 @returns 是否完成。 */
  async completeInterestRun(runId: string, result: GenerationRunRecord['result'], usage: TextModelUsage, timestamp: number): Promise<boolean> {
    return this.client.prepare(`
      UPDATE generation_runs SET status = 'succeeded', result_json = ?, usage_json = ?,
        completed_at = ?, updated_at = ?
      WHERE id = ? AND kind = 'interest_assessment' AND status = 'running'
    `).run(JSON.stringify(result), JSON.stringify(usage), timestamp, timestamp, runId).changes === 1
  }

  /** @param runId 运行 UUID。 @param specId 规格 UUID。 @param spec AI 规划结果。 @param usage 用量。 @param timestamp 完成时间。 @returns 是否保存。 */
  async savePlannedDocumentSpec(runId: string, specId: string, spec: DocumentSpecRecord['spec'], usage: TextModelUsage, timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const changed = this.client.prepare(`
        UPDATE generation_runs SET status = 'awaiting_confirmation', usage_json = ?, updated_at = ?
        WHERE id = ? AND kind = 'artifact_generation' AND status = 'running'
      `).run(JSON.stringify(usage), timestamp, runId)
      if (changed.changes !== 1) return false
      this.client.prepare(`
        INSERT INTO document_specs (id, run_id, revision, status, spec_json, created_at)
        VALUES (?, ?, 1, 'draft', ?, ?)
      `).run(specId, runId, JSON.stringify(spec), timestamp)
      return true
    }).immediate()
  }

  /**
   * 原子确认最新规格、建立文档和块，并创建执行任务。
   * @param runId 运行 UUID。
   * @param documentId 文档 UUID。
   * @param taskId 执行任务 UUID。
   * @param blockIds 与规格块顺序一致的 UUID。
   * @param timestamp 确认时间。
   * @returns 确认成功时为 true。
   */
  async confirmDocumentSpec(runId: string, documentId: string, taskId: string, blockIds: string[], timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const row = this.client.prepare(`
        SELECT id, spec_json FROM document_specs
        WHERE run_id = ? AND status = 'draft' ORDER BY revision DESC LIMIT 1
      `).get(runId) as { id: string, spec_json: string } | undefined
      if (!row) return false
      const spec = documentSpecSchema.parse(JSON.parse(row.spec_json))
      if (spec.blocks.length !== blockIds.length) return false
      const runChanged = this.client.prepare(`
        UPDATE generation_runs SET status = 'queued', updated_at = ?
        WHERE id = ? AND status = 'awaiting_confirmation'
      `).run(timestamp, runId)
      if (runChanged.changes !== 1) return false
      this.client.prepare(`UPDATE document_specs SET status = 'confirmed', confirmed_at = ? WHERE id = ?`).run(timestamp, row.id)
      this.client.prepare(`
        INSERT INTO artifact_documents (id, run_id, selected_spec_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(documentId, runId, row.id, timestamp, timestamp)
      const insertBlock = this.client.prepare(`
        INSERT INTO artifact_blocks (
          id, document_id, spec_key, ordinal, type, role, spec_json, status, is_locked, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      `)
      spec.blocks.forEach((block, index) => {
        insertBlock.run(blockIds[index], documentId, block.key, index, block.type, block.role, JSON.stringify(block), timestamp, timestamp)
      })
      this.client.prepare(`
        INSERT INTO task_jobs (id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
        VALUES (?, ?, 'execute_document', ?, 'queued', 0, 2, ?, ?)
      `).run(taskId, runId, JSON.stringify({ runId }), timestamp, timestamp)
      return true
    }).immediate()
  }

  /** @param runId 运行 UUID。 @param code 稳定错误码。 @param message 脱敏原因。 @param timestamp 完成时间。 @returns 无返回值。 */
  async failRun(runId: string, code: string, message: string, timestamp: number): Promise<void> {
    this.client.prepare(`
      UPDATE generation_runs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND status NOT IN ('succeeded', 'canceled')
    `).run(code, message.slice(0, 1000), timestamp, timestamp, runId)
  }

  /** @param runId 运行 UUID。 @param usage 已收到但因门禁失败尚未保存的供应商用量。 @param timestamp 更新时间。 @returns 无返回值。 */
  async saveRunUsage(runId: string, usage: TextModelUsage, timestamp: number): Promise<void> {
    this.client.prepare(`UPDATE generation_runs SET usage_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(usage), timestamp, runId)
  }

  /**
   * 将临时失败的运行恢复为等待同一任务再次领取的状态。
   * @param runId 运行 UUID。
   * @param taskType 当前任务类型。
   * @param timestamp 更新时间。
   * @returns 无返回值。
   */
  async prepareAutomaticRetry(runId: string, taskType: string, timestamp: number): Promise<void> {
    const status = taskType === 'plan_document' ? 'planning' : 'queued'
    this.client.prepare(`
      UPDATE generation_runs SET status = ?, error_code = NULL, error_message = NULL,
        completed_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(status, timestamp, runId)
  }

  /**
   * 为失败或部分成功运行原子创建新的手工重试任务，保留旧任务和块尝试。
   * @param runId 运行 UUID。
   * @param taskId 新任务 UUID。
   * @param timestamp 创建时间。
   * @returns 新任务类型和运行状态；当前运行不可重试时返回 null。
   */
  async retryRun(runId: string, taskId: string, timestamp: number): Promise<{ taskType: string, status: 'planning' | 'queued' } | null> {
    return this.client.transaction(() => {
      const run = this.client.prepare(`
        SELECT kind, status FROM generation_runs WHERE id = ?
      `).get(runId) as { kind: string, status: string } | undefined
      if (!run || !['failed', 'partial'].includes(run.status)) return null

      const hasDocument = this.client.prepare(`
        SELECT 1 FROM artifact_documents WHERE run_id = ? LIMIT 1
      `).get(runId) !== undefined
      const taskType = run.kind === 'interest_assessment'
        ? 'assess_interest'
        : hasDocument ? 'execute_document' : 'plan_document'
      const status = taskType === 'plan_document' ? 'planning' : 'queued'

      if (taskType === 'execute_document') {
        this.client.prepare(`
          UPDATE artifact_blocks SET status = 'pending', updated_at = ?
          WHERE status = 'failed' AND document_id IN (
            SELECT id FROM artifact_documents WHERE run_id = ?
          ) AND is_locked = 0
        `).run(timestamp, runId)
      }
      const changed = this.client.prepare(`
        UPDATE generation_runs SET status = ?, error_code = NULL, error_message = NULL,
          completed_at = NULL, updated_at = ?
        WHERE id = ? AND status IN ('failed', 'partial')
      `).run(status, timestamp, runId)
      if (changed.changes !== 1) return null
      this.client.prepare(`
        INSERT INTO task_jobs (id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'queued', 0, 2, ?, ?)
      `).run(taskId, runId, taskType, JSON.stringify({ runId }), timestamp, timestamp)
      return { taskType, status }
    }).immediate()
  }

  /** @param runId 运行 UUID。 @param timestamp 请求时间。 @returns 当前状态可取消时为 true。 */
  async requestCancellation(runId: string, timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const run = this.client.prepare('SELECT status FROM generation_runs WHERE id = ?').get(runId) as { status: string } | undefined
      if (!run || !['planning', 'awaiting_confirmation', 'queued', 'running'].includes(run.status)) return false
      const batch = this.client.prepare('SELECT batch_id FROM interest_batch_items WHERE run_id = ?').get(runId) as { batch_id: string } | undefined
      if (batch) {
        const runningTask = this.client.prepare(`
          SELECT 1 FROM task_jobs WHERE status = 'running' AND run_id IN (
            SELECT run_id FROM interest_batch_items WHERE batch_id = ?
          ) LIMIT 1
        `).get(batch.batch_id) !== undefined
        if (runningTask) {
          this.client.prepare(`
            UPDATE task_jobs SET status = 'cancel_requested', cancel_requested_at = ?, updated_at = ?
            WHERE status = 'running' AND run_id IN (
              SELECT run_id FROM interest_batch_items WHERE batch_id = ?
            )
          `).run(timestamp, timestamp, batch.batch_id)
        }
        else {
          this.client.prepare(`
            UPDATE task_jobs SET status = 'canceled', cancel_requested_at = ?, updated_at = ?
            WHERE status = 'queued' AND run_id IN (
              SELECT run_id FROM interest_batch_items WHERE batch_id = ?
            )
          `).run(timestamp, timestamp, batch.batch_id)
          this.client.prepare(`
            UPDATE generation_runs SET status = 'canceled', completed_at = ?, updated_at = ?
            WHERE status IN ('planning', 'queued', 'running') AND id IN (
              SELECT run_id FROM interest_batch_items WHERE batch_id = ?
            )
          `).run(timestamp, timestamp, batch.batch_id)
        }
        return true
      }
      if (run.status === 'running') {
        this.client.prepare(`
          UPDATE task_jobs SET status = 'cancel_requested', cancel_requested_at = ?, updated_at = ?
          WHERE run_id = ? AND status = 'running'
        `).run(timestamp, timestamp, runId)
      }
      else {
        this.client.prepare(`
          UPDATE task_jobs SET status = 'canceled', cancel_requested_at = ?, updated_at = ?
          WHERE run_id = ? AND status = 'queued'
        `).run(timestamp, timestamp, runId)
        this.client.prepare(`
          UPDATE generation_runs SET status = 'canceled', completed_at = ?, updated_at = ? WHERE id = ?
        `).run(timestamp, timestamp, runId)
      }
      return true
    }).immediate()
  }

  /** @param runId 运行 UUID。 @returns 运行任务是否已进入取消请求状态。 */
  async isCancellationRequested(runId: string): Promise<boolean> {
    return this.client.prepare(`SELECT 1 FROM task_jobs WHERE run_id = ? AND status = 'cancel_requested' LIMIT 1`).get(runId) !== undefined
  }

  /** @param runId 运行 UUID。 @param timestamp 完成时间。 @returns 无返回值。 */
  async markRunCanceled(runId: string, timestamp: number): Promise<void> {
    this.client.transaction(() => {
      const batch = this.client.prepare('SELECT batch_id FROM interest_batch_items WHERE run_id = ?').get(runId) as { batch_id: string } | undefined
      if (batch) {
        this.client.prepare(`
          UPDATE generation_runs SET status = 'canceled', completed_at = ?, updated_at = ?
          WHERE id IN (SELECT run_id FROM interest_batch_items WHERE batch_id = ?)
            AND status IN ('planning', 'queued', 'running')
        `).run(timestamp, timestamp, batch.batch_id)
        this.client.prepare(`
          UPDATE task_jobs SET status = 'canceled', lease_until = NULL, updated_at = ?
          WHERE status = 'cancel_requested' AND run_id IN (
            SELECT run_id FROM interest_batch_items WHERE batch_id = ?
          )
        `).run(timestamp, batch.batch_id)
        return
      }
      this.client.prepare(`
        UPDATE block_attempts SET status = 'failed', error_code = 'RUN_CANCELED',
          error_message = '运行已取消', completed_at = ?
        WHERE status = 'running' AND block_id IN (
          SELECT artifact_blocks.id FROM artifact_blocks
          INNER JOIN artifact_documents ON artifact_documents.id = artifact_blocks.document_id
          WHERE artifact_documents.run_id = ?
        )
      `).run(timestamp, runId)
      this.client.prepare(`
        UPDATE artifact_blocks SET status = 'canceled', updated_at = ?
        WHERE status IN ('pending', 'running') AND document_id IN (
          SELECT id FROM artifact_documents WHERE run_id = ?
        )
      `).run(timestamp, runId)
      this.client.prepare(`UPDATE generation_runs SET status = 'canceled', completed_at = ?, updated_at = ? WHERE id = ?`).run(timestamp, timestamp, runId)
      this.client.prepare(`UPDATE task_jobs SET status = 'canceled', lease_until = NULL, updated_at = ? WHERE run_id = ? AND status = 'cancel_requested'`).run(timestamp, runId)
    }).immediate()
  }

  /**
   * 把进程中断遗留的运行中块和尝试恢复为可继续状态。
   * @param runId 运行 UUID。
   * @param timestamp 恢复时间。
   * @returns 被恢复的块数量。
   */
  async recoverInterruptedDocumentBlocks(runId: string, timestamp: number): Promise<number> {
    return this.client.transaction(() => {
      this.client.prepare(`
        UPDATE block_attempts SET status = 'failed', error_code = 'TASK_INTERRUPTED',
          error_message = '任务执行中断，已创建新的恢复尝试', completed_at = ?
        WHERE status = 'running' AND block_id IN (
          SELECT artifact_blocks.id FROM artifact_blocks
          INNER JOIN artifact_documents ON artifact_documents.id = artifact_blocks.document_id
          WHERE artifact_documents.run_id = ?
        )
      `).run(timestamp, runId)
      const changed = this.client.prepare(`
        UPDATE artifact_blocks SET status = 'pending', updated_at = ?
        WHERE status = 'running' AND document_id IN (
          SELECT id FROM artifact_documents WHERE run_id = ?
        )
      `).run(timestamp, runId)
      return changed.changes
    }).immediate()
  }

  /** @param blockId 块 UUID。 @param attemptId 尝试 UUID。 @param inputSnapshot 输入快照。 @param timestamp 开始时间。 @returns 新尝试或 null。 */
  async startBlockAttempt(blockId: string, attemptId: string, inputSnapshot: Record<string, unknown>, timestamp: number): Promise<BlockAttemptRecord | null> {
    return this.client.transaction(() => {
      const row = this.client.prepare(`SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no FROM block_attempts WHERE block_id = ?`).get(blockId) as { attempt_no: number }
      const changed = this.client.prepare(`UPDATE artifact_blocks SET status = 'running', updated_at = ? WHERE id = ? AND status IN ('pending', 'failed')`).run(timestamp, blockId)
      if (changed.changes !== 1) return null
      this.client.prepare(`
        INSERT INTO block_attempts (id, block_id, attempt_no, status, input_snapshot_json, created_at)
        VALUES (?, ?, ?, 'running', ?, ?)
      `).run(attemptId, blockId, row.attempt_no, JSON.stringify(inputSnapshot), timestamp)
      return {
        id: attemptId, blockId, attemptNo: row.attempt_no, status: 'running', inputSnapshot,
        outputText: null, usage: null, errorCode: null, errorMessage: null, createdAt: timestamp, completedAt: null,
      }
    }).immediate()
  }

  /** @param blockId 块 UUID。 @param attemptId 尝试 UUID。 @param outputText 纯文本结果。 @param usage 模型用量。 @param timestamp 完成时间。 @returns 无返回值。 */
  async completeBlockAttempt(blockId: string, attemptId: string, outputText: string, usage: TextModelUsage, timestamp: number): Promise<void> {
    this.client.transaction(() => {
      const attempt = this.client.prepare(`UPDATE block_attempts SET status = 'succeeded', output_text = ?, usage_json = ?, completed_at = ? WHERE id = ? AND block_id = ? AND status = 'running'`).run(outputText, JSON.stringify(usage), timestamp, attemptId, blockId)
      if (attempt.changes !== 1) throw new Error('文字块尝试状态已经变化')
      const block = this.client.prepare(`UPDATE artifact_blocks SET status = 'succeeded', selected_attempt_id = ?, selected_at = ?, updated_at = ? WHERE id = ? AND status = 'running'`).run(attemptId, timestamp, timestamp, blockId)
      if (block.changes !== 1) throw new Error('文字块状态已经变化')
    }).immediate()
  }

  /** @param blockId 图片块 UUID。 @param attemptId 尝试 UUID。 @param asset 本地资产事实。 @param timestamp 完成时间。 @returns 无返回值。 */
  async completeImageBlockAttempt(blockId: string, attemptId: string, asset: Omit<ImageAssetRecord, 'attemptId' | 'createdAt'>, timestamp: number): Promise<void> {
    this.client.transaction(() => {
      const running = this.client.prepare(`
        SELECT 1 FROM block_attempts
        INNER JOIN artifact_blocks ON artifact_blocks.id = block_attempts.block_id
        WHERE block_attempts.id = ? AND block_attempts.block_id = ?
          AND block_attempts.status = 'running' AND artifact_blocks.status = 'running'
      `).get(attemptId, blockId)
      if (!running) throw new Error('图片块或尝试状态已经变化')
      this.client.prepare(`
        INSERT INTO image_assets (id, attempt_id, relative_path, media_type, size_bytes, content_hash, alt_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(asset.id, attemptId, asset.relativePath, asset.mediaType, asset.sizeBytes, asset.contentHash, asset.altText, timestamp)
      const attempt = this.client.prepare(`
        UPDATE block_attempts SET status = 'succeeded', completed_at = ?
        WHERE id = ? AND block_id = ? AND status = 'running'
      `).run(timestamp, attemptId, blockId)
      if (attempt.changes !== 1) throw new Error('图片块尝试状态已经变化')
      const block = this.client.prepare(`
        UPDATE artifact_blocks SET status = 'succeeded', selected_attempt_id = ?, selected_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `).run(attemptId, timestamp, timestamp, blockId)
      if (block.changes !== 1) throw new Error('图片块状态已经变化')
    }).immediate()
  }

  /** @param blockId 块 UUID。 @param attemptId 尝试 UUID。 @param code 稳定错误码。 @param message 脱敏原因。 @param usage 已收到供应商响应时的用量。 @param timestamp 完成时间。 @returns 无返回值。 */
  async failBlockAttempt(blockId: string, attemptId: string, code: string, message: string, usage: TextModelUsage | null, timestamp: number): Promise<void> {
    this.client.transaction(() => {
      this.client.prepare(`UPDATE block_attempts SET status = 'failed', usage_json = ?, error_code = ?, error_message = ?, completed_at = ? WHERE id = ? AND block_id = ? AND status = 'running'`).run(usage ? JSON.stringify(usage) : null, code, message.slice(0, 1000), timestamp, attemptId, blockId)
      this.client.prepare(`
        UPDATE artifact_blocks SET status = CASE WHEN selected_attempt_id IS NOT NULL THEN 'succeeded' ELSE 'failed' END,
          updated_at = ? WHERE id = ?
      `).run(timestamp, blockId)
    }).immediate()
  }

  /** @param runId 运行 UUID。 @param timestamp 完成时间。 @returns 根据块结果计算的最终状态。 */
  async finishDocumentRun(runId: string, timestamp: number): Promise<'succeeded' | 'partial' | 'failed'> {
    return this.client.transaction(() => {
      const counts = this.client.prepare(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN artifact_blocks.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded
        FROM artifact_blocks INNER JOIN artifact_documents ON artifact_documents.id = artifact_blocks.document_id
        WHERE artifact_documents.run_id = ?
      `).get(runId) as { total: number, succeeded: number }
      const status = counts.succeeded === counts.total && counts.total > 0
        ? 'succeeded'
        : counts.succeeded > 0 ? 'partial' : 'failed'
      this.client.prepare(`UPDATE generation_runs SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`).run(status, timestamp, timestamp, runId)
      return status
    }).immediate()
  }
}

/** @param value SQLite 行。 @returns 键值行。 */
function row(value: unknown): Record<string, unknown> { return value as Record<string, unknown> }

/** @param value SQLite 参数方案行。 @returns 已校验参数方案。 */
function toParameterProfile(value: unknown): ParameterProfileRecord {
  const data = row(value)
  return { id: String(data.id), name: String(data.name), version: Number(data.version), scope: data.scope as ParameterProfileRecord['scope'], values: textModelParametersSchema.parse(JSON.parse(String(data.values_json))), isActive: Number(data.is_active) === 1, createdAt: Number(data.created_at) }
}

/** @param value SQLite 格式模板行。 @returns 已校验格式模板。 */
function toFormatTemplate(value: unknown): FormatTemplateRecord {
  const data = row(value)
  return { id: String(data.id), name: String(data.name), version: Number(data.version), spec: formatTemplateSpecSchema.parse(JSON.parse(String(data.spec_json))), isActive: Number(data.is_active) === 1, createdAt: Number(data.created_at) }
}

/** @param value SQLite 运行行。 @returns 已校验运行记录。 */
function toRun(value: unknown): GenerationRunRecord {
  const data = row(value)
  const kind = data.kind as GenerationRunRecord['kind']
  return {
    id: String(data.id), kind, personaVersionId: String(data.persona_version_id),
    formatTemplateId: nullableString(data.format_template_id), parameterProfileId: nullableString(data.parameter_profile_id),
    status: data.status as GenerationRunRecord['status'], input: JSON.parse(String(data.input_json)),
    scene: data.scene_json === null ? null : sceneContextSchema.parse(JSON.parse(String(data.scene_json))),
    parameterSnapshot: textModelParametersSchema.parse(JSON.parse(String(data.parameter_snapshot_json))),
    modelSnapshot: JSON.parse(String(data.model_snapshot_json)) as TextModelSnapshot,
    imageModelSnapshot: data.image_model_snapshot_json === null ? null : JSON.parse(String(data.image_model_snapshot_json)),
    promptVersion: String(data.prompt_version), contextProvider: data.context_provider as GenerationRunRecord['contextProvider'],
    promptContextSnapshot: data.prompt_context_snapshot_json === null
      ? null
      : JSON.parse(String(data.prompt_context_snapshot_json)),
    algorithmSnapshot: data.algorithm_snapshot_json === null || data.algorithm_snapshot_json === undefined
      ? null
      : JSON.parse(String(data.algorithm_snapshot_json)),
    interestAlgorithmSnapshot: data.interest_algorithm_snapshot_json === null || data.interest_algorithm_snapshot_json === undefined
      ? null
      : JSON.parse(String(data.interest_algorithm_snapshot_json)),
    result: data.result_json === null ? null : interestAssessmentSchema.parse(JSON.parse(String(data.result_json))),
    usage: data.usage_json === null ? null : JSON.parse(String(data.usage_json)) as TextModelUsage,
    errorCode: nullableString(data.error_code), errorMessage: nullableString(data.error_message),
    createdAt: Number(data.created_at), updatedAt: Number(data.updated_at), completedAt: nullableNumber(data.completed_at),
  }
}

/** @param value SQLite 证据行。 @returns 证据快照。 */
function toEvidence(value: unknown): EvidenceSnapshotRecord {
  const data = row(value)
  return { id: String(data.id), runId: String(data.run_id), sourceId: nullableString(data.source_id), chunkId: nullableString(data.chunk_id), role: data.role as EvidenceSnapshotRecord['role'], content: String(data.content), contentHash: String(data.content_hash), rank: Number(data.rank), metadata: JSON.parse(String(data.metadata_json)), createdAt: Number(data.created_at) }
}

/** @param value SQLite 规格行。 @returns 已校验规格修订。 */
function toDocumentSpec(value: unknown): DocumentSpecRecord {
  const data = row(value)
  return { id: String(data.id), runId: String(data.run_id), revision: Number(data.revision), status: data.status as DocumentSpecRecord['status'], spec: documentSpecSchema.parse(JSON.parse(String(data.spec_json))), confirmedAt: nullableNumber(data.confirmed_at), createdAt: Number(data.created_at) }
}

/** @param value SQLite 产物块行。 @returns 已校验文字块。 */
function toBlock(value: unknown): ArtifactBlockRecord {
  const data = row(value)
  return { id: String(data.id), documentId: String(data.document_id), specKey: String(data.spec_key), ordinal: Number(data.ordinal), type: data.type as ArtifactBlockRecord['type'], role: data.role as ArtifactBlockRecord['role'], spec: documentSpecSchema.shape.blocks.element.parse(JSON.parse(String(data.spec_json))), status: data.status as ArtifactBlockRecord['status'], selectedAttemptId: nullableString(data.selected_attempt_id), isLocked: Number(data.is_locked) === 1, selectedAt: nullableNumber(data.selected_at), lockedAt: nullableNumber(data.locked_at), createdAt: Number(data.created_at), updatedAt: Number(data.updated_at) }
}

/** @param value SQLite 块尝试行。 @returns 块尝试记录。 */
function toAttempt(value: unknown): BlockAttemptRecord {
  const data = row(value)
  return { id: String(data.id), blockId: String(data.block_id), attemptNo: Number(data.attempt_no), status: data.status as BlockAttemptRecord['status'], inputSnapshot: JSON.parse(String(data.input_snapshot_json)), outputText: nullableString(data.output_text), usage: data.usage_json === null ? null : JSON.parse(String(data.usage_json)) as TextModelUsage, errorCode: nullableString(data.error_code), errorMessage: nullableString(data.error_message), createdAt: Number(data.created_at), completedAt: nullableNumber(data.completed_at) }
}

/** @param value SQLite 任务行。 @returns 运行任务公开记录。 */
function toRunTask(value: unknown): RunTaskRecord {
  const data = row(value)
  return { id: String(data.id), runId: String(data.run_id), type: String(data.type), status: String(data.status), attemptCount: Number(data.attempt_count), maxAttempts: Number(data.max_attempts), lastError: nullableString(data.last_error), createdAt: Number(data.created_at), updatedAt: Number(data.updated_at) }
}

/** @param value SQLite 图片资产行。 @returns 图片资产事实。 */
function toImageAsset(value: unknown): ImageAssetRecord {
  const data = row(value)
  return {
    id: String(data.id), attemptId: String(data.attempt_id), relativePath: String(data.relative_path),
    mediaType: data.media_type as ImageAssetRecord['mediaType'], sizeBytes: Number(data.size_bytes),
    contentHash: String(data.content_hash), altText: String(data.alt_text), createdAt: Number(data.created_at),
  }
}

/** @param value 未知可空字段。 @returns 字符串或 null。 */
function nullableString(value: unknown): string | null { return value === null || value === undefined ? null : String(value) }
/** @param value 未知可空字段。 @returns 数字或 null。 */
function nullableNumber(value: unknown): number | null { return value === null || value === undefined ? null : Number(value) }

/**
 * 合并批次先前用量与本轮用量；任一供应商缺失的字段保持未知。
 * @param previous 批次此前累计用量。
 * @param current 本轮新增用量。
 * @returns 合并后的供应商用量。
 */
function mergeUsage(previous: TextModelUsage | null, current: TextModelUsage): TextModelUsage {
  if (!previous) return current
  const cachedInputTokens = previous.cachedInputTokens === undefined && current.cachedInputTokens === undefined
    ? undefined
    : previous.cachedInputTokens === null || previous.cachedInputTokens === undefined
      || current.cachedInputTokens === null || current.cachedInputTokens === undefined
      ? null
      : previous.cachedInputTokens + current.cachedInputTokens
  return {
    inputTokens: previous.inputTokens === null || current.inputTokens === null ? null : previous.inputTokens + current.inputTokens,
    outputTokens: previous.outputTokens === null || current.outputTokens === null ? null : previous.outputTokens + current.outputTokens,
    totalTokens: previous.totalTokens === null || current.totalTokens === null ? null : previous.totalTokens + current.totalTokens,
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
  }
}
