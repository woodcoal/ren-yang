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
  ParameterProfileRecord,
  TextModelSnapshot,
  TextModelUsage,
} from '../../domain/generation/GenerationModels'
import type {
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
      this.client.prepare(`
        INSERT INTO generation_runs (
          id, kind, persona_version_id, format_template_id, parameter_profile_id, status,
          input_json, scene_json, parameter_snapshot_json, model_snapshot_json, image_model_snapshot_json,
          prompt_version, context_provider, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        command.runId,
        command.kind,
        command.personaVersionId,
        command.formatTemplateId,
        command.parameterProfileId,
        command.status,
        JSON.stringify(command.input),
        command.scene ? JSON.stringify(command.scene) : null,
        JSON.stringify(command.parameters),
        JSON.stringify(command.model),
        command.imageModel ? JSON.stringify(command.imageModel) : null,
        command.promptVersion,
        command.contextProvider,
        command.timestamp,
        command.timestamp,
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
      this.client.prepare(`
        INSERT INTO task_jobs (
          id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'queued', 0, 2, ?, ?)
      `).run(command.taskId, command.runId, command.taskType, JSON.stringify({ runId: command.runId }), command.timestamp, command.timestamp)
    }).immediate()
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

  /** @param runId 运行 UUID。 @param specId 新规格 UUID。 @param spec 用户编辑规格。 @param timestamp 创建时间。 @returns 新修订或 null。 */
  async reviseDocumentSpec(runId: string, specId: string, spec: DocumentSpecRecord['spec'], timestamp: number): Promise<DocumentSpecRecord | null> {
    return this.client.transaction(() => {
      const latest = this.client.prepare(`
        SELECT revision FROM document_specs
        WHERE run_id = ? AND status = 'draft' ORDER BY revision DESC LIMIT 1
      `).get(runId) as { revision: number } | undefined
      const run = this.client.prepare(`
        SELECT 1 FROM generation_runs WHERE id = ? AND status = 'awaiting_confirmation'
      `).get(runId)
      if (!latest || !run) return null
      this.client.prepare(`UPDATE document_specs SET status = 'superseded' WHERE run_id = ? AND status = 'draft'`).run(runId)
      const revision = latest.revision + 1
      this.client.prepare(`
        INSERT INTO document_specs (id, run_id, revision, status, spec_json, created_at)
        VALUES (?, ?, ?, 'draft', ?, ?)
      `).run(specId, runId, revision, JSON.stringify(spec), timestamp)
      return { id: specId, runId, revision, status: 'draft', spec, confirmedAt: null, createdAt: timestamp }
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

  /** @param runId 运行 UUID。 @param blockId 块 UUID。 @param taskId 新任务 UUID。 @param timestamp 创建时间。 @returns 是否入队。 */
  async enqueueBlockRetry(runId: string, blockId: string, taskId: string, timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const block = this.client.prepare(`
        SELECT artifact_blocks.id FROM artifact_blocks
        INNER JOIN artifact_documents ON artifact_documents.id = artifact_blocks.document_id
        WHERE artifact_documents.run_id = ? AND artifact_blocks.id = ?
          AND artifact_blocks.status IN ('succeeded', 'failed') AND artifact_blocks.is_locked = 0
      `).get(runId, blockId)
      if (!block) return false
      const changed = this.client.prepare(`
        UPDATE generation_runs SET status = 'queued', completed_at = NULL, error_code = NULL, error_message = NULL, updated_at = ?
        WHERE id = ? AND status IN ('succeeded', 'partial', 'failed')
      `).run(timestamp, runId)
      if (changed.changes !== 1) return false
      this.client.prepare(`UPDATE artifact_blocks SET status = 'pending', updated_at = ? WHERE id = ?`).run(timestamp, blockId)
      this.client.prepare(`
        INSERT INTO task_jobs (id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
        VALUES (?, ?, 'execute_block', ?, 'queued', 0, 2, ?, ?)
      `).run(taskId, runId, JSON.stringify({ runId, blockId }), timestamp, timestamp)
      return true
    }).immediate()
  }

  /** @param runId 运行 UUID。 @param blockId 块 UUID。 @param attemptId 成功尝试 UUID。 @param timestamp 选择时间。 @returns 是否更新。 */
  async selectBlockAttempt(runId: string, blockId: string, attemptId: string, timestamp: number): Promise<boolean> {
    return this.client.prepare(`
      UPDATE artifact_blocks SET selected_attempt_id = ?, selected_at = ?, status = 'succeeded', updated_at = ?
      WHERE id = ? AND status = 'succeeded' AND document_id IN (
        SELECT artifact_documents.id FROM artifact_documents
        INNER JOIN generation_runs ON generation_runs.id = artifact_documents.run_id
        WHERE artifact_documents.run_id = ? AND generation_runs.status IN ('succeeded', 'partial', 'failed')
      )
        AND EXISTS (
          SELECT 1 FROM block_attempts WHERE id = ? AND block_id = artifact_blocks.id AND status = 'succeeded'
        )
    `).run(attemptId, timestamp, timestamp, blockId, runId, attemptId).changes === 1
  }

  /** @param runId 运行 UUID。 @param blockId 块 UUID。 @param locked 新锁定值。 @param timestamp 操作时间。 @returns 是否更新。 */
  async setBlockLock(runId: string, blockId: string, locked: boolean, timestamp: number): Promise<boolean> {
    return this.client.prepare(`
      UPDATE artifact_blocks SET is_locked = ?, locked_at = ?, updated_at = ?
      WHERE id = ? AND document_id IN (
        SELECT artifact_documents.id FROM artifact_documents
        INNER JOIN generation_runs ON generation_runs.id = artifact_documents.run_id
        WHERE artifact_documents.run_id = ? AND generation_runs.status IN ('succeeded', 'partial', 'failed')
      )
        AND selected_attempt_id IS NOT NULL AND status = 'succeeded'
    `).run(locked ? 1 : 0, locked ? timestamp : null, timestamp, blockId, runId).changes === 1
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
