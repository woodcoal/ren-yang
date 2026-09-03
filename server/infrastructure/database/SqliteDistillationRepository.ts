import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type {
  ConfirmPersonaDistillationCandidateRecord,
  CreatePersonaDistillationRetryRecord,
  CreatePersonaDistillationRunRecord,
  DistillationRepository,
  PersonaDistillationInputRecord,
  PersonaDistillationRunRecord,
  SavePersonaDistillationAnalysisRecord,
  SavePersonaDistillationCandidateRecord,
} from '../../ports/DistillationRepository'
import type { PersonaDistillationSourceRole, PersonaDistillationStatus } from '../../../shared/types/personaDistillation'
import { insertAuditEvent } from './AuditSql'

/** SQLite 返回的人物蒸馏运行行。 */
interface DistillationRunRow {
  id: string
  retry_of_run_id: string | null
  status: PersonaDistillationStatus
  requested_name: string
  objective: string
  world_id: string | null
  mode: PersonaDistillationRunRecord['mode']
  base_soul_version_id: string | null
  provider: 'sqlite_fts5' | 'openviking'
  analysis_report: string | null
  algorithm_snapshot_json: string
  candidate_name: string | null
  candidate_prompt_text: string | null
  candidate_prompt_hash: string | null
  prepared_prompt_hash: string | null
  reviewed_prompt_text: string | null
  created_persona_id: string | null
  error_code: string | null
  error_message: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
}

/** SQLite 返回的人物蒸馏输入行。 */
interface DistillationInputRow {
  id: string
  input_type: PersonaDistillationInputRecord['inputType']
  source_id: string | null
  name: string
  source_role: PersonaDistillationSourceRole | null
  independent_source_key: string | null
  content_hash: string
  content_snapshot: string | null
  source_available: number
  origin_url: string | null
  author_name: string | null
  published_at: number | null
}

/** 使用 SQLite 短事务保存单次自由分析人物蒸馏运行。 */
export class SqliteDistillationRepository implements DistillationRepository {
  /** @param client 已启用外键和 WAL 的 SQLite 客户端。 */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @param record 完整运行、输入和唯一任务命令。 @returns 原子写入完成时结束。 */
  async createRun(record: CreatePersonaDistillationRunRecord): Promise<void> {
    this.client.transaction(() => {
      this.client.prepare(`
        INSERT INTO persona_distillation_runs (
          id, retry_of_run_id, status, requested_name, objective, world_id, mode, base_soul_version_id,
          provider, algorithm_snapshot_json, created_persona_id, created_at, updated_at
        ) VALUES (?, ?, 'analyzing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id, record.retryOfRunId, record.requestedName, record.objective, record.worldId, record.mode,
        record.baseSoulVersionId, record.provider, JSON.stringify(record.algorithmSnapshot), record.createdPersonaId,
        record.timestamp, record.timestamp,
      )
      const insertInput = this.client.prepare(`
        INSERT INTO persona_distillation_inputs (
          id, run_id, input_type, source_id, name, source_role, source_relation, coverage_dimensions_json,
          independent_source_key, content_hash, content_snapshot, source_available, accepted,
          origin_url, author_name, published_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, 1, 1, ?, ?, ?, ?)
      `)
      for (const input of record.inputs) {
        insertInput.run(
          input.id, record.id, input.inputType, input.sourceId, input.name, input.sourceRole,
          input.inputType === 'user_statement' ? 'user_statement' : null,
          input.independentSourceKey, input.contentHash, input.contentSnapshot,
          input.originUrl, input.authorName, input.publishedAt, record.timestamp,
        )
      }
      this.client.prepare(`
        INSERT INTO task_jobs (
          id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at
        ) VALUES (?, NULL, 'distill_persona', ?, 'queued', 0, 2, ?, ?)
      `).run(record.taskId, JSON.stringify({ distillationRunId: record.id, phase: 'analyze' }), record.timestamp, record.timestamp)
      insertAuditEvent(this.client, {
        actor: 'administrator',
        action: record.mode === 'update' ? 'persona_redistillation_created' : 'persona_distillation_created',
        targetType: 'persona_distillation_run', targetId: record.id,
        details: record.mode === 'update' ? { personaId: record.createdPersonaId, baseSoulVersionId: record.baseSoulVersionId } : undefined,
        timestamp: record.timestamp,
      })
    }).immediate()
  }

  /** @param runId 运行 UUID。 @returns 完整运行；不存在时为 null。 */
  async findRun(runId: string): Promise<PersonaDistillationRunRecord | null> {
    const row = this.client.prepare('SELECT * FROM persona_distillation_runs WHERE id = ?').get(runId) as DistillationRunRow | undefined
    if (!row) return null
    const inputs = this.client.prepare(`
      SELECT id, input_type, source_id, name, source_role, independent_source_key, content_hash,
        content_snapshot, source_available, origin_url, author_name, published_at
      FROM persona_distillation_inputs WHERE run_id = ? ORDER BY created_at ASC, id ASC
    `).all(runId) as DistillationInputRow[]
    return {
      id: row.id,
      retryOfRunId: row.retry_of_run_id,
      mode: row.mode,
      baseSoulVersionId: row.base_soul_version_id,
      status: row.status,
      requestedName: row.requested_name,
      objective: row.objective,
      worldId: row.world_id,
      provider: row.provider,
      analysisReport: row.analysis_report,
      algorithmSnapshot: JSON.parse(row.algorithm_snapshot_json) as unknown,
      candidateName: row.candidate_name,
      candidatePromptText: row.candidate_prompt_text,
      candidatePromptHash: row.candidate_prompt_hash,
      preparedPromptHash: row.prepared_prompt_hash,
      reviewedPromptText: row.reviewed_prompt_text,
      createdPersonaId: row.created_persona_id,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      inputs: inputs.map(toInputRecord),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    }
  }

  /** @param record 已校验的自由分析结果。 @returns 运行仍处于分析阶段时为 true。 */
  async saveAnalysis(record: SavePersonaDistillationAnalysisRecord): Promise<boolean> {
    const changed = this.client.prepare(`
      UPDATE persona_distillation_runs
      SET status = 'awaiting_candidate_review', analysis_report = ?, candidate_name = ?, candidate_prompt_text = ?,
        candidate_prompt_hash = ?, prepared_prompt_hash = ?, error_code = NULL, error_message = NULL, updated_at = ?
      WHERE id = ? AND status = 'analyzing'
    `).run(
      record.analysisReport, record.candidateName, record.candidatePromptText, record.candidatePromptHash,
      record.candidatePromptHash, record.timestamp, record.runId,
    )
    if (changed.changes === 1) {
      insertAuditEvent(this.client, {
        actor: 'system', action: 'persona_distillation_analyzed', targetType: 'persona_distillation_run',
        targetId: record.runId, timestamp: record.timestamp,
      })
    }
    return changed.changes === 1
  }

  /** @param record 人工编辑的候选。 @returns 状态和版本仍匹配时为 true。 */
  async saveCandidate(record: SavePersonaDistillationCandidateRecord): Promise<boolean> {
    const changed = this.client.prepare(`
      UPDATE persona_distillation_runs
      SET candidate_prompt_text = ?, candidate_prompt_hash = ?, prepared_prompt_hash = ?, updated_at = ?
      WHERE id = ? AND status = 'awaiting_candidate_review' AND updated_at = ?
    `).run(
      record.candidatePromptText, record.candidatePromptHash, record.candidatePromptHash, record.timestamp,
      record.runId, record.expectedUpdatedAt,
    )
    if (changed.changes === 1) {
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'persona_distillation_candidate_saved', targetType: 'persona_distillation_run',
        targetId: record.runId, timestamp: record.timestamp,
      })
    }
    return changed.changes === 1
  }

  /** @param runId 运行 UUID。 @param timestamp 请求时间。 @returns 当前状态允许取消时为 true。 */
  async requestCancellation(runId: string, timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const run = this.client.prepare('SELECT status FROM persona_distillation_runs WHERE id = ?').get(runId) as { status: PersonaDistillationStatus } | undefined
      if (!run || !['analyzing', 'awaiting_candidate_review'].includes(run.status)) return false
      const running = this.client.prepare(`
        UPDATE task_jobs SET status = 'cancel_requested', cancel_requested_at = ?, updated_at = ?
        WHERE type = 'distill_persona' AND status = 'running' AND json_valid(payload_json)
          AND json_extract(payload_json, '$.distillationRunId') = ?
      `).run(timestamp, timestamp, runId)
      this.client.prepare(`
        UPDATE task_jobs SET status = 'canceled', cancel_requested_at = ?, updated_at = ?
        WHERE type = 'distill_persona' AND status = 'queued' AND json_valid(payload_json)
          AND json_extract(payload_json, '$.distillationRunId') = ?
      `).run(timestamp, timestamp, runId)
      if (running.changes === 0) {
        this.client.prepare(`
          UPDATE persona_distillation_runs SET status = 'canceled', canceled_at = ?, completed_at = ?, updated_at = ?
          WHERE id = ? AND status IN ('analyzing', 'awaiting_candidate_review')
        `).run(timestamp, timestamp, timestamp, runId)
      }
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'persona_distillation_cancel_requested', targetType: 'persona_distillation_run',
        targetId: runId, timestamp,
      })
      return true
    }).immediate()
  }

  /** @param runId 运行 UUID。 @returns 是否已有运行中任务请求协作式取消。 */
  async isCancellationRequested(runId: string): Promise<boolean> {
    return this.client.prepare(`
      SELECT 1 FROM task_jobs WHERE type = 'distill_persona' AND status = 'cancel_requested'
        AND json_valid(payload_json) AND json_extract(payload_json, '$.distillationRunId') = ? LIMIT 1
    `).get(runId) !== undefined
  }

  /** @param runId 运行 UUID。 @param timestamp 安全取消时间。 @returns 运行和任务取消完成时结束。 */
  async markRunCanceled(runId: string, timestamp: number): Promise<void> {
    this.client.transaction(() => {
      this.client.prepare(`
        UPDATE persona_distillation_runs SET status = 'canceled', canceled_at = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('analyzing', 'awaiting_candidate_review')
      `).run(timestamp, timestamp, timestamp, runId)
      this.client.prepare(`
        UPDATE task_jobs SET status = 'canceled', lease_until = NULL, heartbeat_at = NULL, updated_at = ?
        WHERE type = 'distill_persona' AND status = 'cancel_requested' AND json_valid(payload_json)
          AND json_extract(payload_json, '$.distillationRunId') = ?
      `).run(timestamp, runId)
    }).immediate()
  }

  /** @param record 最终人物及候选确认命令。 @returns 原子发布完成时为 true。 */
  async confirmCandidate(record: ConfirmPersonaDistillationCandidateRecord): Promise<boolean> {
    return this.client.transaction(() => {
      const run = this.client.prepare(`
        SELECT mode, world_id, base_soul_version_id, created_persona_id, candidate_prompt_text,
          candidate_prompt_hash, prepared_prompt_hash
        FROM persona_distillation_runs WHERE id = ? AND status = 'awaiting_candidate_review' AND updated_at = ?
      `).get(record.runId, record.expectedUpdatedAt) as {
        mode: 'create' | 'update'
        world_id: string | null
        base_soul_version_id: string | null
        created_persona_id: string | null
        candidate_prompt_text: string | null
        candidate_prompt_hash: string | null
        prepared_prompt_hash: string | null
      } | undefined
      if (!run || !run.candidate_prompt_text || run.candidate_prompt_hash !== record.expectedPromptHash
        || run.prepared_prompt_hash !== record.expectedPromptHash) return false
      if (run.mode === 'update') {
        if (!run.base_soul_version_id || run.created_persona_id !== record.personaId) return false
        const target = this.client.prepare('SELECT active_soul_version_id FROM personas WHERE id = ?').get(record.personaId) as { active_soul_version_id: string | null } | undefined
        if (!target || target.active_soul_version_id !== run.base_soul_version_id) return false
      }
      else {
        this.client.prepare(`
          INSERT INTO personas (id, world_id, name, username, email, password_ciphertext, origin, is_enabled, automatic_learning_enabled, created_at, updated_at)
          VALUES (?, ?, ?, NULL, NULL, NULL, 'original', 1, 0, ?, ?)
        `).run(record.personaId, run.world_id, record.name, record.timestamp, record.timestamp)
      }
      this.client.prepare(`
        INSERT INTO soul_versions (id, subject_type, world_id, persona_id, parent_version_id, prompt_text, runtime_token_count, token_counter, change_summary, status, published_at, created_at)
        VALUES (?, 'persona', NULL, ?, ?, ?, ?, ?, ?, 'published', ?, ?)
      `).run(
        record.soulVersionId, record.personaId, run.mode === 'update' ? run.base_soul_version_id : null,
        run.candidate_prompt_text, record.runtimeTokenCount, record.tokenCounter,
        run.mode === 'update' ? '由人物自由蒸馏生成新灵魂' : '由人物自由蒸馏创建初始灵魂', record.timestamp, record.timestamp,
      )
      if (this.client.prepare('UPDATE personas SET name = ?, active_soul_version_id = ?, updated_at = ? WHERE id = ?')
        .run(record.name, record.soulVersionId, record.timestamp, record.personaId).changes !== 1) {
        throw new Error('人物蒸馏目标人物已变化')
      }
      const sourceIds = this.client.prepare(`
        SELECT DISTINCT source_id FROM persona_distillation_inputs
        WHERE run_id = ? AND input_type = 'source_material' AND source_available = 1 AND source_id IS NOT NULL
      `).all(record.runId) as Array<{ source_id: string }>
      const linkSource = this.client.prepare('INSERT OR IGNORE INTO persona_sources (persona_id, source_id, priority) VALUES (?, ?, 100)')
      for (const source of sourceIds) linkSource.run(record.personaId, source.source_id)
      const completed = this.client.prepare(`
        UPDATE persona_distillation_runs SET status = 'completed', reviewed_prompt_text = candidate_prompt_text,
          created_persona_id = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'awaiting_candidate_review' AND updated_at = ?
          AND candidate_prompt_hash = ? AND prepared_prompt_hash = ?
      `).run(record.personaId, record.timestamp, record.timestamp, record.runId, record.expectedUpdatedAt, record.expectedPromptHash, record.expectedPromptHash)
      if (completed.changes !== 1) throw new Error('人物蒸馏候选确认状态已经变化')
      insertAuditEvent(this.client, {
        actor: 'administrator', action: run.mode === 'update' ? 'persona_redistillation_confirmed' : 'persona_distillation_confirmed',
        targetType: 'persona_distillation_run', targetId: record.runId,
        details: { mode: run.mode, personaId: record.personaId, soulVersionId: record.soulVersionId }, timestamp: record.timestamp,
      })
      return true
    }).immediate()
  }

  /** @param runId 运行 UUID。 @param code 稳定错误码。 @param message 脱敏错误。 @param timestamp 失败时间。 @returns 状态仍允许失败时为 true。 */
  async failRun(runId: string, code: string, message: string, timestamp: number): Promise<boolean> {
    return this.client.prepare(`
      UPDATE persona_distillation_runs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'analyzing'
    `).run(code, message.slice(0, 1000), timestamp, timestamp, runId).changes === 1
  }

  /** @param record 来源失败运行与新运行标识。 @returns 新运行创建成功时为 true。 */
  async createRetry(record: CreatePersonaDistillationRetryRecord): Promise<boolean> {
    return this.client.transaction(() => {
      const source = this.client.prepare(`
        SELECT requested_name, objective, world_id, mode, base_soul_version_id, created_persona_id, provider, algorithm_snapshot_json
        FROM persona_distillation_runs WHERE id = ? AND status = 'failed'
      `).get(record.sourceRunId) as Omit<DistillationRunRow, 'id'> | undefined
      if (!source) return false
      const inputs = this.client.prepare(`
        SELECT id, input_type, source_id, name, source_role, independent_source_key, content_hash, content_snapshot,
          source_available, origin_url, author_name, published_at
        FROM persona_distillation_inputs WHERE run_id = ? ORDER BY created_at ASC, id ASC
      `).all(record.sourceRunId) as DistillationInputRow[]
      if (inputs.length !== record.inputIds.length || inputs.some(input => input.source_available !== 1 || input.content_snapshot === null)) return false
      this.client.prepare(`
        INSERT INTO persona_distillation_runs (
          id, retry_of_run_id, status, requested_name, objective, world_id, mode, base_soul_version_id,
          provider, algorithm_snapshot_json, created_persona_id, created_at, updated_at
        ) VALUES (?, ?, 'analyzing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.runId, record.sourceRunId, source.requested_name, source.objective, source.world_id, source.mode,
        source.base_soul_version_id, source.provider, source.algorithm_snapshot_json, source.created_persona_id,
        record.timestamp, record.timestamp,
      )
      const insertInput = this.client.prepare(`
        INSERT INTO persona_distillation_inputs (
          id, run_id, input_type, source_id, name, source_role, source_relation, coverage_dimensions_json,
          independent_source_key, content_hash, content_snapshot, source_available, accepted,
          origin_url, author_name, published_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, 1, 1, ?, ?, ?, ?)
      `)
      inputs.forEach((input, index) => {
        const inputId = record.inputIds[index]
        if (!inputId || input.content_snapshot === null) throw new Error('人物蒸馏重试输入标识数量不匹配')
        insertInput.run(
          inputId, record.runId, input.input_type, input.source_id, input.name, input.source_role,
          input.input_type === 'user_statement' ? 'user_statement' : null,
          input.independent_source_key, input.content_hash, input.content_snapshot,
          input.origin_url, input.author_name, input.published_at, record.timestamp,
        )
      })
      this.client.prepare(`
        INSERT INTO task_jobs (id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
        VALUES (?, NULL, 'distill_persona', ?, 'queued', 0, 2, ?, ?)
      `).run(record.taskId, JSON.stringify({ distillationRunId: record.runId, phase: 'analyze' }), record.timestamp, record.timestamp)
      insertAuditEvent(this.client, {
        actor: 'administrator', action: 'persona_distillation_retried', targetType: 'persona_distillation_run',
        targetId: record.runId, details: { sourceRunId: record.sourceRunId }, timestamp: record.timestamp,
      })
      return true
    }).immediate()
  }
}

/** @param row SQLite 输入行。 @returns 恢复为严格类型的输入记录。 */
function toInputRecord(row: DistillationInputRow): PersonaDistillationInputRecord {
  return {
    id: row.id,
    inputType: row.input_type,
    sourceId: row.source_id,
    name: row.name,
    sourceRole: row.source_role,
    independentSourceKey: row.independent_source_key,
    contentHash: row.content_hash,
    contentSnapshot: row.content_snapshot,
    sourceAvailable: row.source_available === 1,
    originUrl: row.origin_url,
    authorName: row.author_name,
    publishedAt: row.published_at,
  }
}
