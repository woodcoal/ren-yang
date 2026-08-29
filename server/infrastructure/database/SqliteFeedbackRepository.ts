import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { personaSnapshotSchema } from '../../../shared/schemas/content'
import { textModelParametersSchema } from '../../../shared/schemas/generation'
import type { FeedbackTarget } from '../../../shared/schemas/feedback'
import type { TextModelSnapshot } from '../../domain/generation/GenerationModels'
import type {
  CandidateMemoryRecord,
  EvaluationCaseRecord,
  EvaluationResultRecord,
  EvaluationRunRecord,
  FeedbackEventRecord,
  FeedbackResolutionRecord,
  FeedbackSuggestionRecord,
  RevisionProposalRecord,
} from '../../domain/feedback/FeedbackModels'
import type {
  CreateEvaluationRunCommand,
  CreateRevisionProposalCommand,
  FeedbackAggregate,
  FeedbackRepository,
  PublishProposalResult,
} from '../../ports/FeedbackRepository'

/** 使用 SQLite 短事务保存反馈、人物候选版本、提案和评测事实。 */
export class SqliteFeedbackRepository implements FeedbackRepository {
  /**
   * 创建反馈事实源仓储。
   * @param client 已启用外键与迁移的 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /** @param event 原始反馈。 @param suggestion AI 建议。 @returns 运行和块关系有效时为 true。 */
  async createFeedback(event: FeedbackEventRecord, suggestion: FeedbackSuggestionRecord): Promise<boolean> {
    return this.client.transaction(() => {
      const inserted = this.client.prepare(`
        INSERT INTO feedback_events (id, run_id, block_id, content, rating, is_long_term, edited_output, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM generation_runs WHERE id = ?)
          AND (? IS NULL OR EXISTS (
            SELECT 1 FROM artifact_blocks
            INNER JOIN artifact_documents ON artifact_documents.id = artifact_blocks.document_id
            WHERE artifact_blocks.id = ? AND artifact_documents.run_id = ?
          ))
      `).run(
        event.id, event.runId, event.blockId, event.content, event.rating, event.isLongTerm ? 1 : 0,
        event.editedOutput, event.createdAt, event.runId, event.blockId, event.blockId, event.runId,
      )
      if (inserted.changes !== 1) return false
      this.client.prepare(`
        INSERT INTO feedback_suggestions (
          feedback_id, target_type, confidence_millionths, rationale, model_snapshot_json,
          parameter_snapshot_json, prompt_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        suggestion.feedbackId,
        suggestion.targetType,
        toMillionths(suggestion.confidence),
        suggestion.rationale,
        JSON.stringify(suggestion.modelSnapshot),
        JSON.stringify(suggestion.parameterSnapshot),
        suggestion.promptVersion,
        suggestion.createdAt,
      )
      return true
    }).immediate()
  }

  /** @returns 新反馈在前的完整聚合列表。 */
  async listFeedback(): Promise<FeedbackAggregate[]> {
    return this.client.prepare(feedbackAggregateSql('ORDER BY feedback_events.created_at DESC, feedback_events.id DESC')).all()
      .map(toFeedbackAggregate)
  }

  /** @param feedbackId 反馈 UUID。 @returns 找到的反馈聚合或 null。 */
  async findFeedback(feedbackId: string): Promise<FeedbackAggregate | null> {
    const value = this.client.prepare(feedbackAggregateSql('WHERE feedback_events.id = ?')).get(feedbackId)
    return value ? toFeedbackAggregate(value) : null
  }

  /** @param runId 运行 UUID。 @returns 运行绑定的人物、版本与快照。 */
  async findRunPersonaVersion(runId: string) {
    const value = this.client.prepare(`
      SELECT personas.id AS persona_id, personas.active_version_id, persona_versions.id AS persona_version_id,
        persona_versions.snapshot_json
      FROM generation_runs
      INNER JOIN persona_versions ON persona_versions.id = generation_runs.persona_version_id
      INNER JOIN personas ON personas.id = persona_versions.persona_id
      WHERE generation_runs.id = ?
    `).get(runId)
    if (!value) return null
    const data = row(value)
    return {
      personaId: String(data.persona_id),
      personaVersionId: String(data.persona_version_id),
      snapshot: personaSnapshotSchema.parse(JSON.parse(String(data.snapshot_json))),
      activeVersionId: nullableString(data.active_version_id),
    }
  }

  /** @param versionId 人物版本 UUID。 @returns 版本快照及人物或 null。 */
  async findPersonaVersionSnapshot(versionId: string) {
    const value = this.client.prepare(`SELECT persona_id, snapshot_json FROM persona_versions WHERE id = ?`).get(versionId)
    if (!value) return null
    const data = row(value)
    return {
      personaId: String(data.persona_id),
      snapshot: personaSnapshotSchema.parse(JSON.parse(String(data.snapshot_json))),
    }
  }

  /** @param personaId 人物 UUID。 @returns 当前活动版本 UUID 或 null。 */
  async findPersonaActiveVersionId(personaId: string): Promise<string | null> {
    const value = this.client.prepare('SELECT active_version_id FROM personas WHERE id = ?').get(personaId)
    return value ? nullableString(row(value).active_version_id) : null
  }

  /** @param feedbackId 反馈 UUID。 @param blockId 块 UUID。 @param taskId 新任务 UUID。 @param timestamp 确认时间。 @returns 是否确认并入队。 */
  async confirmArtifactFeedback(feedbackId: string, blockId: string, taskId: string, timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const target = this.client.prepare(`
        SELECT feedback_events.run_id FROM feedback_events
        INNER JOIN artifact_documents ON artifact_documents.run_id = feedback_events.run_id
        INNER JOIN artifact_blocks ON artifact_blocks.document_id = artifact_documents.id
        INNER JOIN generation_runs ON generation_runs.id = feedback_events.run_id
        WHERE feedback_events.id = ? AND artifact_blocks.id = ?
          AND artifact_blocks.status IN ('succeeded', 'failed') AND artifact_blocks.is_locked = 0
          AND generation_runs.status IN ('succeeded', 'partial', 'failed')
          AND NOT EXISTS (SELECT 1 FROM feedback_resolutions WHERE feedback_id = feedback_events.id)
      `).get(feedbackId, blockId)
      if (!target) return false
      const runId = String(row(target).run_id)
      const updatedRun = this.client.prepare(`
        UPDATE generation_runs SET status = 'queued', completed_at = NULL, error_code = NULL,
          error_message = NULL, updated_at = ? WHERE id = ? AND status IN ('succeeded', 'partial', 'failed')
      `).run(timestamp, runId)
      if (updatedRun.changes !== 1) return false
      this.client.prepare(`UPDATE artifact_blocks SET status = 'pending', updated_at = ? WHERE id = ?`).run(timestamp, blockId)
      this.client.prepare(`
        INSERT INTO task_jobs (id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
        VALUES (?, ?, 'execute_block', ?, 'queued', 0, 2, ?, ?)
      `).run(taskId, runId, JSON.stringify({ runId, blockId, feedbackId }), timestamp, timestamp)
      this.client.prepare(`
        INSERT INTO feedback_resolutions (feedback_id, target_type, resolution_json, confirmed_at)
        VALUES (?, 'artifact', ?, ?)
      `).run(feedbackId, JSON.stringify({ blockId, taskId }), timestamp)
      return true
    }).immediate()
  }

  /** @param feedbackId 反馈 UUID。 @param targetType 参数或资料目标。 @param resolution 动作结果。 @param timestamp 确认时间。 @returns 是否首次确认。 */
  async confirmSimpleFeedback(
    feedbackId: string,
    targetType: 'parameters' | 'source_fact',
    resolution: Record<string, unknown>,
    timestamp: number,
  ): Promise<boolean> {
    return this.client.prepare(`
      INSERT INTO feedback_resolutions (feedback_id, target_type, resolution_json, confirmed_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM feedback_events WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM feedback_resolutions WHERE feedback_id = ?)
    `).run(feedbackId, targetType, JSON.stringify(resolution), timestamp, feedbackId, feedbackId).changes === 1
  }

  /** @param command 候选版本、候选记忆、提案与确认结果。 @returns 是否原子创建。 */
  async createRevisionProposal(command: CreateRevisionProposalCommand): Promise<boolean> {
    return this.client.transaction(() => {
      const valid = this.client.prepare(`
        SELECT 1 FROM feedback_events
        INNER JOIN generation_runs ON generation_runs.id = feedback_events.run_id
        INNER JOIN persona_versions ON persona_versions.id = generation_runs.persona_version_id
        WHERE feedback_events.id = ? AND persona_versions.id = ? AND persona_versions.persona_id = ?
          AND NOT EXISTS (SELECT 1 FROM feedback_resolutions WHERE feedback_id = feedback_events.id)
      `).get(command.feedbackId, command.baseVersionId, command.personaId)
      if (!valid) return false

      this.client.prepare(`
        INSERT INTO persona_versions (
          id, persona_id, parent_version_id, status, snapshot_json, change_summary, published_at, created_at
        ) VALUES (?, ?, ?, 'candidate', ?, ?, NULL, ?)
      `).run(
        command.candidateVersionId,
        command.personaId,
        command.baseVersionId,
        JSON.stringify(command.candidateSnapshot),
        command.changeSummary,
        command.timestamp,
      )
      this.client.prepare(`
        INSERT INTO revision_proposals (
          id, feedback_id, persona_id, base_version_id, candidate_version_id, risk_level, status,
          patches_json, risk_reasons_json, has_evidence_conflict, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'awaiting_evaluation', ?, ?, ?, ?, ?)
      `).run(
        command.proposalId,
        command.feedbackId,
        command.personaId,
        command.baseVersionId,
        command.candidateVersionId,
        command.riskLevel,
        JSON.stringify(command.patches),
        JSON.stringify(command.riskReasons),
        command.hasEvidenceConflict ? 1 : 0,
        command.timestamp,
        command.timestamp,
      )
      this.client.prepare(`
        INSERT INTO candidate_memories (id, feedback_id, persona_id, content, status, proposal_id, created_at)
        SELECT ?, id, ?, content, 'promoted', ?, ? FROM feedback_events WHERE id = ?
      `).run(command.memoryId, command.personaId, command.proposalId, command.timestamp, command.feedbackId)
      this.client.prepare(`
        INSERT INTO feedback_resolutions (feedback_id, target_type, resolution_json, confirmed_at)
        VALUES (?, 'persona', ?, ?)
      `).run(command.feedbackId, JSON.stringify(command.resolution), command.timestamp)
      return true
    }).immediate()
  }

  /** @param filter 可选人物和状态筛选。 @returns 新提案在前的列表。 */
  async listRevisionProposals(filter: { personaId?: string, status?: RevisionProposalRecord['status'] }): Promise<RevisionProposalRecord[]> {
    const conditions: string[] = []
    const values: string[] = []
    if (filter.personaId) {
      conditions.push('persona_id = ?')
      values.push(filter.personaId)
    }
    if (filter.status) {
      conditions.push('status = ?')
      values.push(filter.status)
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    return this.client.prepare(`SELECT * FROM revision_proposals ${where} ORDER BY created_at DESC, id DESC`).all(...values)
      .map(toRevisionProposal)
  }

  /** @param proposalId 提案 UUID。 @returns 提案或 null。 */
  async findRevisionProposal(proposalId: string): Promise<RevisionProposalRecord | null> {
    const value = this.client.prepare('SELECT * FROM revision_proposals WHERE id = ?').get(proposalId)
    return value ? toRevisionProposal(value) : null
  }

  /** @param personaId 人物 UUID。 @returns 人物评测用例。 */
  async listEvaluationCases(personaId: string): Promise<EvaluationCaseRecord[]> {
    return this.client.prepare(`
      SELECT * FROM evaluation_cases WHERE persona_id = ? ORDER BY is_active DESC, created_at, id
    `).all(personaId).map(toEvaluationCase)
  }

  /** @param evaluationCase 新评测用例。 @returns 无返回值。 */
  async createEvaluationCase(evaluationCase: EvaluationCaseRecord): Promise<void> {
    this.client.prepare(`
      INSERT INTO evaluation_cases (
        id, persona_id, name, category, prompt, expected_change, assertions_json, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evaluationCase.id,
      evaluationCase.personaId,
      evaluationCase.name,
      evaluationCase.category,
      evaluationCase.prompt,
      evaluationCase.expectedChange,
      JSON.stringify({
        requiredTerms: evaluationCase.requiredTerms,
        forbiddenTerms: evaluationCase.forbiddenTerms,
        minimumScore: evaluationCase.minimumScore,
        maxRegression: evaluationCase.maxRegression,
      }),
      evaluationCase.isActive ? 1 : 0,
      evaluationCase.createdAt,
    )
  }

  /** @param run 固定模型和参数的评测运行。 @param taskId 持久任务 UUID。 @returns 是否原子排队。 */
  async createEvaluationRun(run: CreateEvaluationRunCommand, taskId: string): Promise<boolean> {
    return this.client.transaction(() => {
      const proposal = this.client.prepare(`
        SELECT 1 FROM revision_proposals WHERE id = ? AND candidate_version_id = ?
          AND status IN ('awaiting_evaluation', 'evaluation_failed', 'ready')
          AND NOT EXISTS (SELECT 1 FROM evaluation_runs WHERE proposal_id = ? AND status IN ('queued', 'running'))
      `).get(run.proposalId, run.candidateVersionId, run.proposalId)
      if (!proposal) return false
      this.client.prepare(`
        INSERT INTO evaluation_runs (
          id, proposal_id, candidate_version_id, status, model_snapshot_json, parameter_snapshot_json,
          prompt_version, passed_cases, total_cases, error_code, error_message, created_at, completed_at
        ) VALUES (?, ?, ?, 'queued', ?, ?, ?, 0, ?, NULL, NULL, ?, NULL)
      `).run(
        run.id,
        run.proposalId,
        run.candidateVersionId,
        JSON.stringify(run.modelSnapshot),
        JSON.stringify(run.parameterSnapshot),
        run.promptVersion,
        run.totalCases,
        run.createdAt,
      )
      this.client.prepare(`
        INSERT INTO task_jobs (id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
        VALUES (?, NULL, 'evaluate_proposal', ?, 'queued', 0, 2, ?, ?)
      `).run(taskId, JSON.stringify({ evaluationRunId: run.id }), run.createdAt, run.createdAt)
      this.client.prepare(`
        UPDATE revision_proposals SET status = 'awaiting_evaluation', latest_evaluation_run_id = ?,
          decision_reason = NULL, updated_at = ? WHERE id = ?
      `).run(run.id, run.createdAt, run.proposalId)
      return true
    }).immediate()
  }

  /** @param runId 评测 UUID。 @returns 是否从排队进入运行。 */
  async startEvaluationRun(runId: string): Promise<boolean> {
    return this.client.prepare(`
      UPDATE evaluation_runs SET status = 'running', error_code = NULL, error_message = NULL
      WHERE id = ? AND status IN ('queued', 'running')
    `).run(runId).changes === 1
  }

  /** @param runId 评测 UUID。 @returns 为自动重试恢复排队状态。 */
  async prepareEvaluationRetry(runId: string): Promise<void> {
    this.client.prepare(`UPDATE evaluation_runs SET status = 'queued' WHERE id = ? AND status = 'running'`).run(runId)
  }

  /** @param runId 评测 UUID。 @param results 逐用例结果。 @param status 汇总结论。 @param timestamp 完成时间。 @returns 无返回值。 */
  async completeEvaluationRun(
    runId: string,
    results: EvaluationResultRecord[],
    status: 'passed' | 'failed',
    timestamp: number,
  ): Promise<void> {
    this.client.transaction(() => {
      const run = this.client.prepare(`SELECT proposal_id FROM evaluation_runs WHERE id = ? AND status IN ('queued', 'running')`).get(runId)
      if (!run) throw new Error('评测运行已经结束或不存在')
      const insert = this.client.prepare(`
        INSERT INTO evaluation_results (
          id, evaluation_run_id, case_id, case_name, status, base_score_millionths,
          candidate_score_millionths, base_output, candidate_output, failures_json, reasoning_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const result of results) {
        insert.run(
          result.id,
          result.evaluationRunId,
          result.caseId,
          result.caseName,
          result.status,
          toMillionths(result.baseScore),
          toMillionths(result.candidateScore),
          result.baseOutput,
          result.candidateOutput,
          JSON.stringify(result.failures),
          result.reasoningSummary,
        )
      }
      const passed = results.filter(result => result.status === 'passed').length
      this.client.prepare(`
        UPDATE evaluation_runs SET status = ?, passed_cases = ?, completed_at = ? WHERE id = ? AND status = 'running'
      `).run(status, passed, timestamp, runId)
      this.client.prepare(`
        UPDATE revision_proposals SET status = ?, updated_at = ? WHERE id = ? AND latest_evaluation_run_id = ?
      `).run(status === 'passed' ? 'ready' : 'evaluation_failed', timestamp, String(row(run).proposal_id), runId)
    }).immediate()
  }

  /** @param runId 评测 UUID。 @param code 稳定错误码。 @param message 脱敏原因。 @param timestamp 完成时间。 @returns 无返回值。 */
  async failEvaluationRun(runId: string, code: string, message: string, timestamp: number): Promise<void> {
    this.client.transaction(() => {
      const run = this.client.prepare(`SELECT proposal_id FROM evaluation_runs WHERE id = ? AND status = 'running'`).get(runId)
      if (!run) return
      this.client.prepare(`
        UPDATE evaluation_runs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?
        WHERE id = ? AND status IN ('queued', 'running')
      `).run(code, message.slice(0, 1_000), timestamp, runId)
      this.client.prepare(`
        UPDATE revision_proposals SET status = 'evaluation_failed', updated_at = ?
        WHERE id = ? AND latest_evaluation_run_id = ?
      `).run(timestamp, String(row(run).proposal_id), runId)
    }).immediate()
  }

  /** @param runId 评测 UUID。 @returns 运行及逐用例结果或 null。 */
  async findEvaluationRun(runId: string): Promise<{ run: EvaluationRunRecord, results: EvaluationResultRecord[] } | null> {
    const runValue = this.client.prepare('SELECT * FROM evaluation_runs WHERE id = ?').get(runId)
    if (!runValue) return null
    const results = this.client.prepare(`
      SELECT * FROM evaluation_results WHERE evaluation_run_id = ? ORDER BY rowid
    `).all(runId).map(toEvaluationResult)
    return { run: toEvaluationRun(runValue), results }
  }

  /** @param proposalId 提案 UUID。 @param reason 发布原因。 @param timestamp 发布时间。 @returns 原子发布结果。 */
  async publishProposal(proposalId: string, reason: string, timestamp: number): Promise<PublishProposalResult> {
    return this.client.transaction(() => {
      const value = this.client.prepare(`
        SELECT revision_proposals.*, personas.active_version_id, persona_versions.status AS candidate_status,
          evaluation_runs.status AS evaluation_status
        FROM revision_proposals
        INNER JOIN personas ON personas.id = revision_proposals.persona_id
        INNER JOIN persona_versions ON persona_versions.id = revision_proposals.candidate_version_id
        LEFT JOIN evaluation_runs ON evaluation_runs.id = revision_proposals.latest_evaluation_run_id
        WHERE revision_proposals.id = ?
      `).get(proposalId)
      if (!value) return 'already_decided'
      const data = row(value)
      if (data.status === 'published' || data.status === 'rejected' || data.candidate_status !== 'candidate') return 'already_decided'
      if (data.status !== 'ready' || data.evaluation_status !== 'passed') return 'not_ready'
      if (data.active_version_id !== data.base_version_id) return 'base_version_changed'

      this.client.prepare(`
        UPDATE persona_versions SET status = 'published', published_at = ? WHERE id = ? AND status = 'candidate'
      `).run(timestamp, String(data.candidate_version_id))
      this.client.prepare(`
        UPDATE personas SET active_version_id = ?, updated_at = ? WHERE id = ? AND active_version_id = ?
      `).run(String(data.candidate_version_id), timestamp, String(data.persona_id), String(data.base_version_id))
      this.client.prepare(`
        UPDATE revision_proposals SET status = 'published', decision_reason = ?, updated_at = ? WHERE id = ?
      `).run(reason, timestamp, proposalId)
      this.client.prepare(`UPDATE candidate_memories SET status = 'promoted' WHERE proposal_id = ?`).run(proposalId)
      return 'published'
    }).immediate()
  }

  /** @param proposalId 提案 UUID。 @param reason 拒绝原因。 @param timestamp 拒绝时间。 @returns 是否拒绝。 */
  async rejectProposal(proposalId: string, reason: string, timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const value = this.client.prepare(`
        SELECT candidate_version_id FROM revision_proposals
        WHERE id = ? AND status NOT IN ('published', 'rejected')
      `).get(proposalId)
      if (!value) return false
      const candidateVersionId = String(row(value).candidate_version_id)
      this.client.prepare(`UPDATE persona_versions SET status = 'rejected' WHERE id = ? AND status = 'candidate'`).run(candidateVersionId)
      this.client.prepare(`
        UPDATE revision_proposals SET status = 'rejected', decision_reason = ?, updated_at = ? WHERE id = ?
      `).run(reason, timestamp, proposalId)
      this.client.prepare(`UPDATE candidate_memories SET status = 'rejected' WHERE proposal_id = ?`).run(proposalId)
      return true
    }).immediate()
  }

  /** @param personaId 人物 UUID。 @returns 是否存在。 */
  async personaExists(personaId: string): Promise<boolean> {
    return Boolean(this.client.prepare('SELECT 1 FROM personas WHERE id = ?').get(personaId))
  }

  /** @param sourceId 资料 UUID。 @returns 是否存在。 */
  async sourceExists(sourceId: string): Promise<boolean> {
    return Boolean(this.client.prepare('SELECT 1 FROM source_materials WHERE id = ?').get(sourceId))
  }

  /** @param feedbackId 反馈 UUID。 @returns 候选记忆或 null。 */
  async findCandidateMemory(feedbackId: string): Promise<CandidateMemoryRecord | null> {
    const value = this.client.prepare('SELECT * FROM candidate_memories WHERE feedback_id = ?').get(feedbackId)
    return value ? toCandidateMemory(value) : null
  }
}

/** @param suffix 可控的 WHERE 或 ORDER BY 子句。 @returns 反馈聚合固定查询。 */
function feedbackAggregateSql(suffix: string): string {
  return `
    SELECT feedback_events.*,
      feedback_suggestions.target_type AS suggested_target,
      feedback_suggestions.confidence_millionths,
      feedback_suggestions.rationale,
      feedback_suggestions.model_snapshot_json,
      feedback_suggestions.parameter_snapshot_json,
      feedback_suggestions.prompt_version,
      feedback_suggestions.created_at AS suggestion_created_at,
      feedback_resolutions.target_type AS confirmed_target,
      feedback_resolutions.resolution_json,
      feedback_resolutions.confirmed_at
    FROM feedback_events
    INNER JOIN feedback_suggestions ON feedback_suggestions.feedback_id = feedback_events.id
    LEFT JOIN feedback_resolutions ON feedback_resolutions.feedback_id = feedback_events.id
    ${suffix}
  `
}

/** @param value SQLite 行。 @returns 键值行。 */
function row(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

/** @param value SQLite 可空值。 @returns 字符串或 null。 */
function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

/** @param value 0 到 1 的分数。 @returns 避免 SQLite 浮点差异的百万分整数。 */
function toMillionths(value: number): number {
  return Math.round(value * 1_000_000)
}

/** @param value 百万分整数。 @returns 0 到 1 的业务分数。 */
function fromMillionths(value: unknown): number {
  return Number(value) / 1_000_000
}

/** @param value SQLite 联表行。 @returns 已解析反馈聚合。 */
function toFeedbackAggregate(value: unknown): FeedbackAggregate {
  const data = row(value)
  const event: FeedbackEventRecord = {
    id: String(data.id),
    runId: String(data.run_id),
    blockId: nullableString(data.block_id),
    content: String(data.content),
    rating: nullableString(data.rating) as FeedbackEventRecord['rating'],
    isLongTerm: Number(data.is_long_term) === 1,
    editedOutput: nullableString(data.edited_output),
    createdAt: Number(data.created_at),
  }
  const suggestion: FeedbackSuggestionRecord = {
    feedbackId: event.id,
    targetType: data.suggested_target as FeedbackTarget,
    confidence: fromMillionths(data.confidence_millionths),
    rationale: String(data.rationale),
    modelSnapshot: JSON.parse(String(data.model_snapshot_json)) as TextModelSnapshot,
    parameterSnapshot: textModelParametersSchema.parse(JSON.parse(String(data.parameter_snapshot_json))),
    promptVersion: String(data.prompt_version),
    createdAt: Number(data.suggestion_created_at),
  }
  const resolution: FeedbackResolutionRecord | null = data.confirmed_target === null
    ? null
    : {
        feedbackId: event.id,
        targetType: data.confirmed_target as FeedbackTarget,
        resolution: JSON.parse(String(data.resolution_json)) as Record<string, unknown>,
        confirmedAt: Number(data.confirmed_at),
      }
  return { event, suggestion, resolution }
}

/** @param value SQLite 行。 @returns 修订提案。 */
function toRevisionProposal(value: unknown): RevisionProposalRecord {
  const data = row(value)
  return {
    id: String(data.id),
    feedbackId: String(data.feedback_id),
    personaId: String(data.persona_id),
    baseVersionId: String(data.base_version_id),
    candidateVersionId: String(data.candidate_version_id),
    riskLevel: data.risk_level as RevisionProposalRecord['riskLevel'],
    status: data.status as RevisionProposalRecord['status'],
    patches: JSON.parse(String(data.patches_json)) as RevisionProposalRecord['patches'],
    riskReasons: JSON.parse(String(data.risk_reasons_json)) as string[],
    hasEvidenceConflict: Number(data.has_evidence_conflict) === 1,
    latestEvaluationRunId: nullableString(data.latest_evaluation_run_id),
    decisionReason: nullableString(data.decision_reason),
    createdAt: Number(data.created_at),
    updatedAt: Number(data.updated_at),
  }
}

/** @param value SQLite 行。 @returns 评测用例。 */
function toEvaluationCase(value: unknown): EvaluationCaseRecord {
  const data = row(value)
  const assertions = JSON.parse(String(data.assertions_json)) as Record<string, unknown>
  return {
    id: String(data.id),
    personaId: String(data.persona_id),
    name: String(data.name),
    category: data.category as EvaluationCaseRecord['category'],
    prompt: String(data.prompt),
    expectedChange: data.expected_change as EvaluationCaseRecord['expectedChange'],
    requiredTerms: assertions.requiredTerms as string[],
    forbiddenTerms: assertions.forbiddenTerms as string[],
    minimumScore: Number(assertions.minimumScore),
    maxRegression: Number(assertions.maxRegression),
    isActive: Number(data.is_active) === 1,
    createdAt: Number(data.created_at),
  }
}

/** @param value SQLite 行。 @returns 评测运行。 */
function toEvaluationRun(value: unknown): EvaluationRunRecord {
  const data = row(value)
  return {
    id: String(data.id),
    proposalId: String(data.proposal_id),
    candidateVersionId: String(data.candidate_version_id),
    status: data.status as EvaluationRunRecord['status'],
    modelSnapshot: JSON.parse(String(data.model_snapshot_json)) as TextModelSnapshot,
    parameterSnapshot: textModelParametersSchema.parse(JSON.parse(String(data.parameter_snapshot_json))),
    promptVersion: String(data.prompt_version),
    passedCases: Number(data.passed_cases),
    totalCases: Number(data.total_cases),
    errorCode: nullableString(data.error_code),
    errorMessage: nullableString(data.error_message),
    createdAt: Number(data.created_at),
    completedAt: data.completed_at === null ? null : Number(data.completed_at),
  }
}

/** @param value SQLite 行。 @returns 逐用例评测结果。 */
function toEvaluationResult(value: unknown): EvaluationResultRecord {
  const data = row(value)
  return {
    id: String(data.id),
    evaluationRunId: String(data.evaluation_run_id),
    caseId: String(data.case_id),
    caseName: String(data.case_name),
    status: data.status as EvaluationResultRecord['status'],
    baseScore: fromMillionths(data.base_score_millionths),
    candidateScore: fromMillionths(data.candidate_score_millionths),
    baseOutput: String(data.base_output),
    candidateOutput: String(data.candidate_output),
    failures: JSON.parse(String(data.failures_json)) as string[],
    reasoningSummary: String(data.reasoning_summary),
  }
}

/** @param value SQLite 行。 @returns 候选记忆。 */
function toCandidateMemory(value: unknown): CandidateMemoryRecord {
  const data = row(value)
  return {
    id: String(data.id),
    feedbackId: String(data.feedback_id),
    personaId: String(data.persona_id),
    content: String(data.content),
    status: data.status as CandidateMemoryRecord['status'],
    proposalId: nullableString(data.proposal_id),
    createdAt: Number(data.created_at),
  }
}
