import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type {
  CreatePersonaDistillationRunRecord,
  CreatePersonaDistillationRetryRecord,
  ConfirmPersonaDistillationSourcesRecord,
  ConfirmPersonaDistillationCandidateRecord,
  DistillationRepository,
  PersonaDistillationClaimRecord,
  PersonaDistillationEvaluationRecord,
  PersonaDistillationInputRecord,
  PersonaDistillationRunRecord,
  SavePersonaDistillationSourceAssessmentRecord,
  SavePersonaDistillationEvaluationRecord,
  SavePersonaDistillationCandidateRecord,
  SavePersonaDistillationExtractionRecord,
  SavePersonaDistillationSynthesisRecord,
  PersonaDistillationSourceRole,
} from '../../ports/DistillationRepository'
import type {
  PersonaDistillationCoverageDimension,
  PersonaDistillationSourceRelation,
  PersonaDistillationStatus,
} from '../../../shared/types/personaDistillation'
import { insertAuditEvent } from './AuditSql'

/** SQLite 返回的人物蒸馏运行行。 */
interface DistillationRunRow {
  id: string
  retry_of_run_id: string | null
  status: PersonaDistillationStatus
  requested_name: string
  objective: string
  world_id: string | null
  provider: 'sqlite_fts5' | 'openviking'
  coverage_snapshot_json: string | null
  algorithm_snapshot_json: string
  raw_extraction_json: string | null
  validated_extraction_json: string | null
  quality_gate_json: string | null
  candidate_name: string | null
  candidate_prompt_text: string | null
  candidate_prompt_hash: string | null
  evaluated_prompt_hash: string | null
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
  source_relation: PersonaDistillationSourceRelation | null
  coverage_dimensions_json: string
  independent_source_key: string | null
  content_hash: string
  content_snapshot: string | null
  source_available: number
  accepted: number
  origin_url: string | null
  author_name: string | null
  published_at: number | null
}

/** SQLite 返回的人物认知候选行。 */
interface DistillationClaimRow {
  id: string
  category: PersonaDistillationClaimRecord['category']
  statement: string
  applicability: string
  limitations: string
  basis: PersonaDistillationClaimRecord['basis']
  confidence_millionths: number
  independent_source_count: number
  cross_context_count: number
  status: PersonaDistillationClaimRecord['status']
  rejection_reasons_json: string
  warnings_json: string
  conflicts_json: string
}

/** SQLite 返回的人物候选证据行。 */
interface DistillationEvidenceRow {
  id: string
  claim_id: string
  input_id: string
  relation: 'supporting' | 'opposing'
  quote: string
  quote_hash: string
}

/** SQLite 返回的人物候选评测行。 */
interface DistillationEvaluationRow {
  id: string
  round_no: number
  candidate_prompt_hash: string
  evaluation_type: PersonaDistillationEvaluationRecord['evaluationType']
  input_json: string
  expected_json: string
  output_json: string
  status: PersonaDistillationEvaluationRecord['status']
  score_millionths: number | null
  failure_reasons_json: string
}

/** 使用 SQLite 短事务保存人物蒸馏运行、输入和任务。 */
export class SqliteDistillationRepository implements DistillationRepository {
  /**
   * 创建人物蒸馏仓储适配器。
   * @param client 已启用外键和 WAL 的 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /**
   * 原子创建运行、不可变输入、审计和首个资料评估任务。
   * @param record 完整运行创建命令。
   * @returns 写入完成时结束。
   */
  async createRun(record: CreatePersonaDistillationRunRecord): Promise<void> {
    this.client.transaction(() => {
      this.client.prepare(`
        INSERT INTO persona_distillation_runs (
          id, retry_of_run_id, status, requested_name, objective, world_id, provider,
          algorithm_snapshot_json, created_at, updated_at
        ) VALUES (?, ?, 'assessing_sources', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.retryOfRunId,
        record.requestedName,
        record.objective,
        record.worldId,
        record.provider,
        JSON.stringify(record.algorithmSnapshot),
        record.timestamp,
        record.timestamp,
      )
      const insertInput = this.client.prepare(`
        INSERT INTO persona_distillation_inputs (
          id, run_id, input_type, source_id, name, source_role, source_relation,
          coverage_dimensions_json, independent_source_key, content_hash, content_snapshot,
          source_available, accepted, origin_url, author_name, published_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)
      `)
      for (const input of record.inputs) {
        insertInput.run(
          input.id,
          record.id,
          input.inputType,
          input.sourceId,
          input.name,
          input.sourceRole,
          input.sourceRelation,
          JSON.stringify(input.coverageDimensions),
          input.independentSourceKey,
          input.contentHash,
          input.contentSnapshot,
          input.originUrl,
          input.authorName,
          input.publishedAt,
          record.timestamp,
        )
      }
      this.client.prepare(`
        INSERT INTO task_jobs (
          id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at
        ) VALUES (?, NULL, 'distill_persona', ?, 'queued', 0, 2, ?, ?)
      `).run(
        record.taskId,
        JSON.stringify({ distillationRunId: record.id, phase: 'assess_sources' }),
        record.timestamp,
        record.timestamp,
      )
      insertAuditEvent(this.client, {
        actor: 'administrator',
        action: 'persona_distillation_created',
        targetType: 'persona_distillation_run',
        targetId: record.id,
        timestamp: record.timestamp,
      })
    }).immediate()
  }

  /**
   * 读取人物蒸馏运行及其不可变输入。
   * @param runId 运行 UUID。
   * @returns 解析后的完整运行；不存在时为 null。
   */
  async findRun(runId: string): Promise<PersonaDistillationRunRecord | null> {
    const row = this.client.prepare(`
      SELECT * FROM persona_distillation_runs WHERE id = ?
    `).get(runId) as DistillationRunRow | undefined
    if (!row) return null
    const inputs = this.client.prepare(`
      SELECT id, input_type, source_id, name, source_role, source_relation,
        coverage_dimensions_json, independent_source_key, content_hash, content_snapshot,
        source_available, accepted, origin_url, author_name, published_at
      FROM persona_distillation_inputs
      WHERE run_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(runId) as DistillationInputRow[]
    const claimRows = this.client.prepare(`
      SELECT id, category, statement, applicability, limitations, basis, confidence_millionths,
        independent_source_count, cross_context_count, status, rejection_reasons_json,
        warnings_json, conflicts_json
      FROM persona_distillation_claims WHERE run_id = ? ORDER BY created_at ASC, id ASC
    `).all(runId) as DistillationClaimRow[]
    const evidenceRows = this.client.prepare(`
      SELECT evidence.id, evidence.claim_id, evidence.input_id, evidence.relation, evidence.quote, evidence.quote_hash
      FROM persona_distillation_evidence AS evidence
      INNER JOIN persona_distillation_claims AS claim ON claim.id = evidence.claim_id
      WHERE claim.run_id = ? ORDER BY evidence.created_at ASC, evidence.id ASC
    `).all(runId) as DistillationEvidenceRow[]
    const evaluationRows = this.client.prepare(`
      SELECT id, round_no, evaluation_type, candidate_prompt_hash, input_json, expected_json, output_json,
        status, score_millionths, failure_reasons_json
      FROM persona_distillation_evaluations
      WHERE run_id = ? ORDER BY round_no ASC, evaluation_type ASC, id ASC
    `).all(runId) as DistillationEvaluationRow[]
    return {
      id: row.id,
      retryOfRunId: row.retry_of_run_id,
      status: row.status,
      requestedName: row.requested_name,
      objective: row.objective,
      worldId: row.world_id,
      provider: row.provider,
      coverageSnapshot: parseOptionalJson(row.coverage_snapshot_json),
      algorithmSnapshot: JSON.parse(row.algorithm_snapshot_json) as unknown,
      rawExtraction: parseOptionalJson(row.raw_extraction_json),
      validatedExtraction: parseOptionalJson(row.validated_extraction_json),
      qualityGate: parseOptionalJson(row.quality_gate_json),
      candidateName: row.candidate_name,
      candidatePromptText: row.candidate_prompt_text,
      candidatePromptHash: row.candidate_prompt_hash,
      evaluatedPromptHash: row.evaluated_prompt_hash,
      reviewedPromptText: row.reviewed_prompt_text,
      createdPersonaId: row.created_persona_id,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      inputs: inputs.map(toInputRecord),
      claims: claimRows.map(claim => toClaimRecord(claim, evidenceRows.filter(evidence => evidence.claim_id === claim.id))),
      evaluations: evaluationRows.map(toEvaluationRecord),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    }
  }

  /**
   * 保存资料分类与覆盖快照，并把运行推进到人工资料确认。
   * @param record 已通过模型结构和输入一一对应校验的结果。
   * @returns 运行仍处于资料评估阶段时为 true。
   */
  async saveSourceAssessment(record: SavePersonaDistillationSourceAssessmentRecord): Promise<boolean> {
    return this.client.transaction(() => {
      const changed = this.client.prepare(`
        UPDATE persona_distillation_runs
        SET status = 'awaiting_source_review', coverage_snapshot_json = ?, updated_at = ?
        WHERE id = ? AND status = 'assessing_sources'
      `).run(JSON.stringify(record.coverage), record.timestamp, record.runId)
      if (changed.changes !== 1) return false
      const updateInput = this.client.prepare(`
        UPDATE persona_distillation_inputs
        SET source_relation = ?, coverage_dimensions_json = ?, independent_source_key = ?
        WHERE id = ? AND run_id = ? AND input_type = 'source_material'
      `)
      for (const source of record.assessment.sources) {
        const result = updateInput.run(
          source.sourceRelation,
          JSON.stringify(source.coverageDimensions),
          source.independentSourceKey,
          source.inputId,
          record.runId,
        )
        if (result.changes !== 1) throw new Error('人物蒸馏资料分类与运行输入不一致')
      }
      insertAuditEvent(this.client, {
        actor: 'system',
        action: 'persona_distillation_sources_assessed',
        targetType: 'persona_distillation_run',
        targetId: record.runId,
        timestamp: record.timestamp,
      })
      return true
    }).immediate()
  }

  /**
   * 以运行状态和更新时间为条件确认资料范围，并原子创建认知提取任务。
   * @param record 人工选择、分类纠正、并发版本和任务标识。
   * @returns 确认成功时为 true；状态或版本变化时为 false。
   */
  async confirmSources(record: ConfirmPersonaDistillationSourcesRecord): Promise<boolean> {
    return this.client.transaction(() => {
      const changed = this.client.prepare(`
        UPDATE persona_distillation_runs
        SET status = 'extracting', source_reviewed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'awaiting_source_review' AND updated_at = ?
      `).run(record.timestamp, record.timestamp, record.runId, record.expectedUpdatedAt)
      if (changed.changes !== 1) return false
      const updateCorrection = this.client.prepare(`
        UPDATE persona_distillation_inputs
        SET source_relation = COALESCE(?, source_relation),
          coverage_dimensions_json = COALESCE(?, coverage_dimensions_json)
        WHERE id = ? AND run_id = ? AND input_type = 'source_material'
      `)
      for (const correction of record.corrections) {
        const result = updateCorrection.run(
          correction.sourceRelation ?? null,
          correction.coverageDimensions ? JSON.stringify(correction.coverageDimensions) : null,
          correction.inputId,
          record.runId,
        )
        if (result.changes !== 1) throw new Error('人物蒸馏资料纠正引用了无效输入')
      }
      this.client.prepare(`
        UPDATE persona_distillation_inputs SET accepted = 0
        WHERE run_id = ? AND input_type = 'source_material'
      `).run(record.runId)
      const acceptInput = this.client.prepare(`
        UPDATE persona_distillation_inputs SET accepted = 1
        WHERE id = ? AND run_id = ? AND input_type = 'source_material' AND source_available = 1
      `)
      for (const inputId of record.acceptedInputIds) {
        if (acceptInput.run(inputId, record.runId).changes !== 1) {
          throw new Error('人物蒸馏资料确认引用了无效或已删除输入')
        }
      }
      this.client.prepare(`
        INSERT INTO task_jobs (
          id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at
        ) VALUES (?, NULL, 'distill_persona', ?, 'queued', 0, 2, ?, ?)
      `).run(
        record.taskId,
        JSON.stringify({ distillationRunId: record.runId, phase: 'extract_claims' }),
        record.timestamp,
        record.timestamp,
      )
      insertAuditEvent(this.client, {
        actor: 'administrator',
        action: 'persona_distillation_sources_confirmed',
        targetType: 'persona_distillation_run',
        targetId: record.runId,
        timestamp: record.timestamp,
      })
      return true
    }).immediate()
  }

  /**
   * 原子保存模型原始输出、程序校验候选、精确证据和质量门禁。
   * @param record 已完成全部证据校验的认知提取结果。
   * @returns 运行仍处于认知提取阶段时为 true。
   */
  async saveExtraction(record: SavePersonaDistillationExtractionRecord): Promise<boolean> {
    return this.client.transaction(() => {
      const changed = this.client.prepare(`
        UPDATE persona_distillation_runs
        SET status = 'synthesizing', raw_extraction_json = ?, validated_extraction_json = ?,
          quality_gate_json = ?, updated_at = ?
        WHERE id = ? AND status = 'extracting'
      `).run(
        JSON.stringify(record.rawExtraction),
        JSON.stringify(record.claims),
        JSON.stringify(record.qualityGate),
        record.timestamp,
        record.runId,
      )
      if (changed.changes !== 1) return false
      const insertClaim = this.client.prepare(`
        INSERT INTO persona_distillation_claims (
          id, run_id, category, statement, applicability, limitations, basis,
          confidence_millionths, independent_source_count, cross_context_count,
          status, rejection_reasons_json, warnings_json, conflicts_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertEvidence = this.client.prepare(`
        INSERT INTO persona_distillation_evidence (
          id, claim_id, input_id, relation, quote, quote_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const claim of record.claims) {
        insertClaim.run(
          claim.id,
          record.runId,
          claim.category,
          claim.statement,
          claim.applicability,
          claim.limitations,
          claim.basis,
          Math.round(claim.confidence * 1_000_000),
          claim.independentSourceCount,
          claim.crossContextCount,
          claim.status,
          JSON.stringify(claim.rejectionReasons),
          JSON.stringify(claim.warnings),
          JSON.stringify(claim.conflicts),
          record.timestamp,
        )
        for (const evidence of claim.evidence) {
          insertEvidence.run(
            evidence.id,
            claim.id,
            evidence.inputId,
            evidence.relation,
            evidence.quote,
            evidence.quoteHash,
            record.timestamp,
          )
        }
      }
      return true
    }).immediate()
  }

  /**
   * 保存完整候选灵魂并使运行进入首轮评测。
   * @param record 候选名称、正文、SHA-256 和保存时间。
   * @returns 运行仍处于灵魂综合阶段时为 true。
   */
  async saveSynthesis(record: SavePersonaDistillationSynthesisRecord): Promise<boolean> {
    const result = this.client.prepare(`
      UPDATE persona_distillation_runs
      SET status = 'evaluating', candidate_name = ?, candidate_prompt_text = ?,
        candidate_prompt_hash = ?, evaluated_prompt_hash = NULL, updated_at = ?
      WHERE id = ? AND status = 'synthesizing'
    `).run(
      record.candidateName,
      record.candidatePromptText,
      record.candidatePromptHash,
      record.timestamp,
      record.runId,
    )
    return result.changes === 1
  }

  /**
   * 保存一轮候选评测，并只在没有硬失败时记录通过评测的候选哈希。
   * @param record 当前候选哈希、逐维评测、硬失败和保存时间。
   * @returns 状态和候选哈希仍匹配时为 true。
   */
  async saveEvaluation(record: SavePersonaDistillationEvaluationRecord): Promise<boolean> {
    return this.client.transaction(() => {
      const changed = this.client.prepare(`
        UPDATE persona_distillation_runs
        SET status = 'awaiting_candidate_review', evaluated_prompt_hash = ?, updated_at = ?
        WHERE id = ? AND status = 'evaluating' AND candidate_prompt_hash = ?
      `).run(
        record.hardFailures.length === 0 ? record.candidatePromptHash : null,
        record.timestamp,
        record.runId,
        record.candidatePromptHash,
      )
      if (changed.changes !== 1) return false
      const insertEvaluation = this.client.prepare(`
        INSERT INTO persona_distillation_evaluations (
          id, run_id, round_no, evaluation_type, candidate_prompt_hash,
          input_json, expected_json, output_json, status, score_millionths,
          failure_reasons_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const evaluation of record.evaluations) {
        insertEvaluation.run(
          evaluation.id,
          record.runId,
          evaluation.roundNo,
          evaluation.evaluationType,
          record.candidatePromptHash,
          JSON.stringify(evaluation.input),
          JSON.stringify(evaluation.expected),
          JSON.stringify(evaluation.output),
          evaluation.status,
          evaluation.score === null ? null : Math.round(evaluation.score * 1_000_000),
          JSON.stringify(evaluation.failureReasons),
          record.timestamp,
        )
      }
      return true
    }).immediate()
  }

  /**
   * 保存人工编辑候选、清除旧评测哈希并原子创建重新评测任务。
   * @param record 新候选正文、哈希、页面并发版本和任务标识。
   * @returns 状态和更新时间仍匹配时为 true。
   */
  async saveCandidateForEvaluation(record: SavePersonaDistillationCandidateRecord): Promise<boolean> {
    return this.client.transaction(() => {
      const changed = this.client.prepare(`
        UPDATE persona_distillation_runs
        SET status = 'evaluating', candidate_prompt_text = ?, candidate_prompt_hash = ?,
          evaluated_prompt_hash = NULL, updated_at = ?
        WHERE id = ? AND status = 'awaiting_candidate_review' AND updated_at = ?
      `).run(
        record.candidatePromptText,
        record.candidatePromptHash,
        record.timestamp,
        record.runId,
        record.expectedUpdatedAt,
      )
      if (changed.changes !== 1) return false
      this.client.prepare(`
        INSERT INTO task_jobs (
          id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at
        ) VALUES (?, NULL, 'distill_persona', ?, 'queued', 0, 2, ?, ?)
      `).run(
        record.taskId,
        JSON.stringify({ distillationRunId: record.runId, phase: 'evaluate_soul' }),
        record.timestamp,
        record.timestamp,
      )
      insertAuditEvent(this.client, {
        actor: 'administrator',
        action: 'persona_distillation_candidate_saved',
        targetType: 'persona_distillation_run',
        targetId: record.runId,
        timestamp: record.timestamp,
      })
      return true
    }).immediate()
  }

  /**
   * 请求取消人物蒸馏；未运行任务立即取消，运行中任务等待安全点。
   * @param runId 运行 UUID。
   * @param timestamp 请求时间。
   * @returns 运行存在且尚未终止时为 true。
   */
  async requestCancellation(runId: string, timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const run = this.client.prepare(`
        SELECT status FROM persona_distillation_runs WHERE id = ?
      `).get(runId) as { status: PersonaDistillationStatus } | undefined
      if (!run || ['completed', 'failed', 'canceled'].includes(run.status)) return false
      const running = this.client.prepare(`
        UPDATE task_jobs
        SET status = 'cancel_requested', cancel_requested_at = ?, updated_at = ?
        WHERE type = 'distill_persona' AND status = 'running'
          AND json_valid(payload_json)
          AND json_extract(payload_json, '$.distillationRunId') = ?
      `).run(timestamp, timestamp, runId)
      this.client.prepare(`
        UPDATE task_jobs
        SET status = 'canceled', cancel_requested_at = ?, updated_at = ?
        WHERE type = 'distill_persona' AND status = 'queued'
          AND json_valid(payload_json)
          AND json_extract(payload_json, '$.distillationRunId') = ?
      `).run(timestamp, timestamp, runId)
      if (running.changes === 0) {
        this.client.prepare(`
          UPDATE persona_distillation_runs
          SET status = 'canceled', canceled_at = ?, completed_at = ?, updated_at = ? WHERE id = ?
        `).run(timestamp, timestamp, timestamp, runId)
      }
      insertAuditEvent(this.client, {
        actor: 'administrator',
        action: 'persona_distillation_cancel_requested',
        targetType: 'persona_distillation_run',
        targetId: runId,
        timestamp,
      })
      return true
    }).immediate()
  }

  /**
   * 查询人物蒸馏是否已有运行中任务请求协作式取消。
   * @param runId 运行 UUID。
   * @returns 存在取消请求时为 true。
   */
  async isCancellationRequested(runId: string): Promise<boolean> {
    return this.client.prepare(`
      SELECT 1 FROM task_jobs
      WHERE type = 'distill_persona' AND status = 'cancel_requested'
        AND json_valid(payload_json)
        AND json_extract(payload_json, '$.distillationRunId') = ?
      LIMIT 1
    `).get(runId) !== undefined
  }

  /**
   * 在模型调用或阶段保存前的安全点同时终止人物蒸馏运行与取消请求任务。
   * @param runId 运行 UUID。
   * @param timestamp 安全取消时间。
   * @returns 事务完成时结束。
   */
  async markRunCanceled(runId: string, timestamp: number): Promise<void> {
    this.client.transaction(() => {
      this.client.prepare(`
        UPDATE persona_distillation_runs
        SET status = 'canceled', canceled_at = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND status NOT IN ('completed', 'failed', 'canceled')
      `).run(timestamp, timestamp, timestamp, runId)
      this.client.prepare(`
        UPDATE task_jobs SET status = 'canceled', lease_until = NULL, heartbeat_at = NULL, updated_at = ?
        WHERE type = 'distill_persona' AND status = 'cancel_requested'
          AND json_valid(payload_json)
          AND json_extract(payload_json, '$.distillationRunId') = ?
      `).run(timestamp, runId)
    }).immediate()
  }

  /**
   * 原子确认已评测候选，并创建人物、初始当前灵魂版本和确认资料关系。
   * @param record 候选哈希、并发版本、新标识和 Token 预算快照。
   * @returns 状态、更新时间和评测哈希都匹配时为 true。
   */
  async confirmAndCreatePersona(record: ConfirmPersonaDistillationCandidateRecord): Promise<boolean> {
    return this.client.transaction(() => {
      const run = this.client.prepare(`
        SELECT world_id, candidate_prompt_text, candidate_prompt_hash, evaluated_prompt_hash
        FROM persona_distillation_runs
        WHERE id = ? AND status = 'awaiting_candidate_review' AND updated_at = ?
      `).get(record.runId, record.expectedUpdatedAt) as {
        world_id: string | null
        candidate_prompt_text: string | null
        candidate_prompt_hash: string | null
        evaluated_prompt_hash: string | null
      } | undefined
      if (!run || !run.candidate_prompt_text
        || run.candidate_prompt_hash !== record.expectedPromptHash
        || run.evaluated_prompt_hash !== record.expectedPromptHash) return false
      this.client.prepare(`
        INSERT INTO personas (
          id, world_id, name, username, email, password_ciphertext, origin,
          is_enabled, automatic_learning_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, NULL, NULL, 'original', 1, 0, ?, ?)
      `).run(record.personaId, run.world_id, record.name, record.timestamp, record.timestamp)
      this.client.prepare(`
        INSERT INTO soul_versions (
          id, subject_type, world_id, persona_id, parent_version_id, prompt_text,
          runtime_token_count, token_counter, change_summary, status, published_at, created_at
        ) VALUES (?, 'persona', NULL, ?, NULL, ?, ?, ?, '由人物蒸馏创建初始灵魂', 'published', ?, ?)
      `).run(
        record.soulVersionId,
        record.personaId,
        run.candidate_prompt_text,
        record.runtimeTokenCount,
        record.tokenCounter,
        record.timestamp,
        record.timestamp,
      )
      this.client.prepare(`
        UPDATE personas SET active_soul_version_id = ? WHERE id = ?
      `).run(record.soulVersionId, record.personaId)
      const acceptedSources = this.client.prepare(`
        SELECT DISTINCT source_id FROM persona_distillation_inputs
        WHERE run_id = ? AND input_type = 'source_material' AND accepted = 1
          AND source_available = 1 AND source_id IS NOT NULL
      `).all(record.runId) as Array<{ source_id: string }>
      const linkSource = this.client.prepare(`
        INSERT INTO persona_sources (persona_id, source_id, priority) VALUES (?, ?, 100)
      `)
      for (const source of acceptedSources) linkSource.run(record.personaId, source.source_id)
      const completed = this.client.prepare(`
        UPDATE persona_distillation_runs
        SET status = 'completed', reviewed_prompt_text = candidate_prompt_text,
          created_persona_id = ?, completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'awaiting_candidate_review' AND updated_at = ?
          AND candidate_prompt_hash = ? AND evaluated_prompt_hash = ?
      `).run(
        record.personaId,
        record.timestamp,
        record.timestamp,
        record.runId,
        record.expectedUpdatedAt,
        record.expectedPromptHash,
        record.expectedPromptHash,
      )
      if (completed.changes !== 1) throw new Error('人物蒸馏候选确认状态已经变化')
      insertAuditEvent(this.client, {
        actor: 'administrator',
        action: 'persona_distillation_confirmed',
        targetType: 'persona_distillation_run',
        targetId: record.runId,
        details: { personaId: record.personaId, soulVersionId: record.soulVersionId },
        timestamp: record.timestamp,
      })
      return true
    }).immediate()
  }

  /**
   * 以脱敏错误终止正在执行模型步骤的人物蒸馏运行。
   * @param runId 运行 UUID。
   * @param code 稳定错误码。
   * @param message 最多保存一千字的脱敏说明。
   * @param timestamp 失败时间。
   * @returns 当前状态仍允许失败时为 true。
   */
  async failRun(runId: string, code: string, message: string, timestamp: number): Promise<boolean> {
    const result = this.client.prepare(`
      UPDATE persona_distillation_runs
      SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('assessing_sources', 'extracting', 'synthesizing', 'evaluating')
    `).run(code, message.slice(0, 1000), timestamp, timestamp, runId)
    return result.changes === 1
  }

  /**
   * 从失败运行的原始输入和算法快照原子创建一项全新重试运行。
   * @param record 来源运行、新运行、任务、输入标识和创建时间。
   * @returns 来源仍失败、输入完整且新运行创建成功时为 true。
   */
  async createRetry(record: CreatePersonaDistillationRetryRecord): Promise<boolean> {
    return this.client.transaction(() => {
      const source = this.client.prepare(`
        SELECT requested_name, objective, world_id, provider, algorithm_snapshot_json
        FROM persona_distillation_runs WHERE id = ? AND status = 'failed'
      `).get(record.sourceRunId) as {
        requested_name: string
        objective: string
        world_id: string | null
        provider: 'sqlite_fts5' | 'openviking'
        algorithm_snapshot_json: string
      } | undefined
      if (!source) return false
      const inputs = this.client.prepare(`
        SELECT id, input_type, source_id, name, source_role, source_relation,
          coverage_dimensions_json, independent_source_key, content_hash, content_snapshot,
          source_available, accepted, origin_url, author_name, published_at
        FROM persona_distillation_inputs WHERE run_id = ? ORDER BY created_at ASC, id ASC
      `).all(record.sourceRunId) as DistillationInputRow[]
      if (inputs.length !== record.inputIds.length
        || inputs.some(input => input.source_available !== 1 || input.content_snapshot === null)) return false
      this.client.prepare(`
        INSERT INTO persona_distillation_runs (
          id, retry_of_run_id, status, requested_name, objective, world_id, provider,
          algorithm_snapshot_json, created_at, updated_at
        ) VALUES (?, ?, 'assessing_sources', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.runId,
        record.sourceRunId,
        source.requested_name,
        source.objective,
        source.world_id,
        source.provider,
        source.algorithm_snapshot_json,
        record.timestamp,
        record.timestamp,
      )
      const insertInput = this.client.prepare(`
        INSERT INTO persona_distillation_inputs (
          id, run_id, input_type, source_id, name, source_role, source_relation,
          coverage_dimensions_json, independent_source_key, content_hash, content_snapshot,
          source_available, accepted, origin_url, author_name, published_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)
      `)
      inputs.forEach((input, index) => {
        const inputId = record.inputIds[index]
        if (!inputId) throw new Error('人物蒸馏重试输入标识数量不匹配')
        const isRequirement = input.input_type === 'user_statement'
        insertInput.run(
          inputId,
          record.runId,
          input.input_type,
          input.source_id,
          input.name,
          input.source_role,
          isRequirement ? 'user_statement' : null,
          isRequirement ? input.coverage_dimensions_json : '[]',
          input.independent_source_key,
          input.content_hash,
          input.content_snapshot,
          input.origin_url,
          input.author_name,
          input.published_at,
          record.timestamp,
        )
      })
      this.client.prepare(`
        INSERT INTO task_jobs (
          id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at
        ) VALUES (?, NULL, 'distill_persona', ?, 'queued', 0, 2, ?, ?)
      `).run(
        record.taskId,
        JSON.stringify({ distillationRunId: record.runId, phase: 'assess_sources' }),
        record.timestamp,
        record.timestamp,
      )
      insertAuditEvent(this.client, {
        actor: 'administrator',
        action: 'persona_distillation_retried',
        targetType: 'persona_distillation_run',
        targetId: record.runId,
        details: { sourceRunId: record.sourceRunId },
        timestamp: record.timestamp,
      })
      return true
    }).immediate()
  }
}

/**
 * 把 SQLite 输入行转换为严格类型的仓储记录。
 * @param row 已通过数据库约束的输入行。
 * @returns 布尔值和覆盖维度已经还原的输入记录。
 */
function toInputRecord(row: DistillationInputRow): PersonaDistillationInputRecord {
  return {
    id: row.id,
    inputType: row.input_type,
    sourceId: row.source_id,
    name: row.name,
    sourceRole: row.source_role,
    sourceRelation: row.source_relation,
    coverageDimensions: JSON.parse(row.coverage_dimensions_json) as PersonaDistillationCoverageDimension[],
    independentSourceKey: row.independent_source_key,
    contentHash: row.content_hash,
    contentSnapshot: row.content_snapshot,
    sourceAvailable: row.source_available === 1,
    accepted: row.accepted === 1,
    originUrl: row.origin_url,
    authorName: row.author_name,
    publishedAt: row.published_at,
  }
}

/**
 * 把候选行和所属证据行还原为完整仓储记录。
 * @param row 已通过数据库约束的候选行。
 * @param evidenceRows 只属于该候选的证据行。
 * @returns 数值、JSON 和证据已经还原的认知候选。
 */
function toClaimRecord(row: DistillationClaimRow, evidenceRows: DistillationEvidenceRow[]): PersonaDistillationClaimRecord {
  return {
    id: row.id,
    category: row.category,
    statement: row.statement,
    applicability: row.applicability,
    limitations: row.limitations,
    basis: row.basis,
    confidence: row.confidence_millionths / 1_000_000,
    independentSourceCount: row.independent_source_count,
    crossContextCount: row.cross_context_count,
    status: row.status,
    rejectionReasons: JSON.parse(row.rejection_reasons_json) as string[],
    warnings: JSON.parse(row.warnings_json) as string[],
    conflicts: JSON.parse(row.conflicts_json) as string[],
    evidence: evidenceRows.map(evidence => ({
      id: evidence.id,
      inputId: evidence.input_id,
      relation: evidence.relation,
      quote: evidence.quote,
      quoteHash: evidence.quote_hash,
    })),
  }
}

/**
 * 把 SQLite 评测行还原为严格类型的仓储记录。
 * @param row 已通过数据库约束的评测行。
 * @returns JSON 与百万分比率已经还原的评测记录。
 */
function toEvaluationRecord(row: DistillationEvaluationRow): PersonaDistillationEvaluationRecord {
  return {
    id: row.id,
    roundNo: row.round_no,
    candidatePromptHash: row.candidate_prompt_hash,
    evaluationType: row.evaluation_type,
    input: JSON.parse(row.input_json) as unknown,
    expected: JSON.parse(row.expected_json) as unknown,
    output: JSON.parse(row.output_json) as unknown,
    status: row.status,
    score: row.score_millionths === null ? null : row.score_millionths / 1_000_000,
    failureReasons: JSON.parse(row.failure_reasons_json) as string[],
  }
}

/**
 * 解析可以为空的 JSON 数据库字段。
 * @param value 数据库 JSON 字符串或 null。
 * @returns 解析值；字段为空时返回 null。
 */
function parseOptionalJson(value: string | null): unknown | null {
  return value === null ? null : JSON.parse(value) as unknown
}
