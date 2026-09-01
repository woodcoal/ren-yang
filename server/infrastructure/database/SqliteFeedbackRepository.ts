import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { textModelParametersSchema } from '../../../shared/schemas/generation'
import type { FeedbackTarget } from '../../../shared/schemas/feedback'
import type { TextModelSnapshot } from '../../domain/generation/GenerationModels'
import type {
  FeedbackEventRecord,
  FeedbackResolutionRecord,
  FeedbackSuggestionRecord,
} from '../../domain/feedback/FeedbackModels'
import type {
  ConfirmPersonaLearningFeedbackCommand,
  FeedbackAggregate,
  FeedbackRepository,
} from '../../ports/FeedbackRepository'
import { insertAuditEvent } from './AuditSql'

/** 使用 SQLite 短事务保存反馈、确认动作和人物成长原始素材。 */
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

  /** @param runId 运行 UUID。 @returns 运行固定的人物及人物版本或 null。 */
  async findRunPersona(runId: string): Promise<{ personaId: string, personaVersionId: string } | null> {
    const value = this.client.prepare(`
      SELECT soul_versions.persona_id, generation_runs.persona_version_id
      FROM generation_runs
      INNER JOIN soul_versions ON soul_versions.id = generation_runs.persona_version_id
      WHERE generation_runs.id = ?
        AND soul_versions.subject_type = 'persona'
        AND soul_versions.persona_id IS NOT NULL
    `).get(runId)
    return value
      ? { personaId: String(row(value).persona_id), personaVersionId: String(row(value).persona_version_id) }
      : null
  }

  /** @param feedbackId 反馈 UUID。 @param blockId 块 UUID。 @param taskId 新任务 UUID。 @param timestamp 确认时间。 @returns 是否确认并入队。 */
  async confirmArtifactFeedback(feedbackId: string, blockId: string, taskId: string, timestamp: number): Promise<boolean> {
    return this.client.transaction(() => {
      const target = this.client.prepare(`
        SELECT feedback_events.run_id, feedback_events.content FROM feedback_events
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
      const correctionInstruction = String(row(target).content)
      const updatedRun = this.client.prepare(`
        UPDATE generation_runs SET status = 'queued', completed_at = NULL, error_code = NULL,
          error_message = NULL, updated_at = ? WHERE id = ? AND status IN ('succeeded', 'partial', 'failed')
      `).run(timestamp, runId)
      if (updatedRun.changes !== 1) return false
      this.client.prepare(`UPDATE artifact_blocks SET status = 'pending', updated_at = ? WHERE id = ?`).run(timestamp, blockId)
      this.client.prepare(`
        INSERT INTO task_jobs (id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
        VALUES (?, ?, 'execute_block', ?, 'queued', 0, 2, ?, ?)
      `).run(taskId, runId, JSON.stringify({ runId, blockId, feedbackId, correctionInstruction }), timestamp, timestamp)
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

  /** @param command 原始反馈、所属人物和新成长素材事实。 @returns 是否原子确认并创建人物成长素材。 */
  async confirmPersonaLearningFeedback(command: ConfirmPersonaLearningFeedbackCommand): Promise<boolean> {
    return this.client.transaction(() => {
      const value = this.client.prepare(`
        SELECT feedback_events.content
        FROM feedback_events
        INNER JOIN generation_runs ON generation_runs.id = feedback_events.run_id
        INNER JOIN soul_versions ON soul_versions.id = generation_runs.persona_version_id
        WHERE feedback_events.id = ?
          AND soul_versions.subject_type = 'persona'
          AND soul_versions.persona_id = ?
          AND NOT EXISTS (SELECT 1 FROM feedback_resolutions WHERE feedback_id = feedback_events.id)
      `).get(command.feedbackId, command.personaId)
      if (!value) return false
      const content = String(row(value).content)
      const contentHash = createHash('sha256').update(content).digest('hex')
      this.client.prepare(`
        INSERT INTO persona_feedback_sources (
          id, persona_id, title, content, source_type, source_id, is_enabled,
          content_hash, deletion_state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'run_feedback', ?, 1, ?, 'active', ?, ?)
      `).run(
        command.feedbackSourceId,
        command.personaId,
        command.title,
        content,
        command.feedbackId,
        contentHash,
        command.timestamp,
        command.timestamp,
      )
      // 反馈资料表继续承担 OpenViking 投影兼容；同一固定内容同时成为新成长流程可见的独立素材。
      this.client.prepare(`
        INSERT INTO growth_materials (
          id, subject_type, world_id, persona_id, title, content_snapshot, content_hash,
          source_type, source_id, source_hash, importance, is_enabled, created_at, updated_at
        ) VALUES (?, 'persona', NULL, ?, ?, ?, ?, 'manual', NULL, NULL, 3, 1, ?, ?)
      `).run(
        command.feedbackSourceId,
        command.personaId,
        command.title,
        content,
        contentHash,
        command.timestamp,
        command.timestamp,
      )
      this.client.prepare(`
        INSERT INTO feedback_resolutions (feedback_id, target_type, resolution_json, confirmed_at)
        VALUES (?, 'persona', ?, ?)
      `).run(command.feedbackId, JSON.stringify({
        feedbackSourceId: command.feedbackSourceId,
        growthMaterialId: command.feedbackSourceId,
        personaId: command.personaId,
        action: 'created_growth_material',
      }), command.timestamp)
      insertAuditEvent(this.client, {
        actor: 'administrator',
        action: 'feedback_promoted_to_growth_material',
        targetType: 'growth_material',
        targetId: command.feedbackSourceId,
        details: { feedbackId: command.feedbackId, personaId: command.personaId },
        timestamp: command.timestamp,
      })
      return true
    }).immediate()
  }

  /** @param sourceId 资料 UUID。 @returns 资料是否存在。 */
  async sourceExists(sourceId: string): Promise<boolean> {
    return Boolean(this.client.prepare('SELECT 1 FROM source_materials WHERE id = ?').get(sourceId))
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
