import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { ContextSyncTaskQueue } from '../../ports/ContextSyncTaskQueue'
import { OPEN_VIKING_SYNC_MAX_ATTEMPTS } from '../../domain/context/OpenVikingRetryPolicy'

/** 使用现有持久任务表排队 OpenViking 单资料同步。 */
export class SqliteContextSyncTaskQueue implements ContextSyncTaskQueue {
  /**
   * 创建 SQLite 增量同步任务队列。
   * @param client 已迁移 SQLite 客户端。
   * @param isEnabled 当前数据库配置是否启用 OpenViking。
   */
  constructor(
    private readonly client: BetterSqliteDatabase,
    private readonly isEnabled: () => boolean = () => true,
  ) {}

  /** @param taskId 新任务 UUID。 @param timestamp 创建时间。 @returns 无返回值；已有待处理对账时保持幂等。 */
  async enqueueUserReconciliation(taskId: string, timestamp: number): Promise<void> {
    if (!this.isEnabled()) return
    this.client.prepare(`
      INSERT INTO task_jobs (
        id, run_id, type, payload_json, status, attempt_count, max_attempts, available_at, created_at, updated_at
      ) SELECT ?, NULL, 'sync_openviking_users', '{}', 'queued', 0, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM task_jobs
        WHERE type = 'sync_openviking_users' AND status IN ('queued', 'running')
      )
    `).run(taskId, OPEN_VIKING_SYNC_MAX_ATTEMPTS, timestamp, timestamp, timestamp)
  }

  /**
   * 创建最多尝试十次且不绑定生成运行的同步任务；同资料已有排队任务时复用并提前到更早时间。
   * @param sourceId 资料 UUID。
   * @param taskId 新任务 UUID。
   * @param timestamp 创建时间，UTC Unix 毫秒。
   * @param entityType 普通资料或人物反馈资料。
   * @param notBefore 最早领取时间；自动退避时可以晚于创建时间。
   * @returns 无返回值。
   */
  async enqueueSourceSynchronization(
    sourceId: string,
    taskId: string,
    timestamp: number,
    entityType: 'source_material' | 'persona_feedback_source' = 'source_material',
    notBefore = timestamp,
  ): Promise<void> {
    if (!this.isEnabled()) return
    const availableAt = Math.max(timestamp, notBefore)
    this.client.transaction(() => {
      const existing = this.client.prepare(`
        UPDATE task_jobs SET available_at = MIN(available_at, ?), updated_at = ?
        WHERE type = 'sync_context_source' AND status IN ('queued', 'running')
          AND COALESCE(json_extract(payload_json, '$.entityType'), 'source_material') = ?
          AND json_extract(payload_json, '$.sourceId') = ?
      `).run(availableAt, timestamp, entityType, sourceId)
      if (existing.changes > 0) return
      this.client.prepare(`
        INSERT INTO task_jobs (
          id, run_id, type, payload_json, status, attempt_count, max_attempts, available_at, created_at, updated_at
        ) VALUES (?, NULL, 'sync_context_source', ?, 'queued', 0, ?, ?, ?, ?)
      `).run(
        taskId,
        JSON.stringify({ entityType, sourceId }),
        OPEN_VIKING_SYNC_MAX_ATTEMPTS,
        availableAt,
        timestamp,
        timestamp,
      )
    }).immediate()
  }

  /** @param sourceType 生成运行或反馈。 @param sourceId 本地 UUID。 @param taskId 新任务 UUID。 @param timestamp 创建时间。 @returns 无返回值；同来源已有待处理任务时保持幂等。 */
  async enqueueSessionSynchronization(sourceType: 'run' | 'feedback', sourceId: string, taskId: string, timestamp: number): Promise<void> {
    if (!this.isEnabled()) return
    this.client.prepare(`
      INSERT INTO task_jobs (
        id, run_id, type, payload_json, status, attempt_count, max_attempts, available_at, created_at, updated_at
      ) SELECT ?, NULL, 'sync_openviking_session', ?, 'queued', 0, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM task_jobs
        WHERE type = 'sync_openviking_session' AND status IN ('queued', 'running')
          AND json_extract(payload_json, '$.sourceType') = ?
          AND json_extract(payload_json, '$.sourceId') = ?
      )
    `).run(
      taskId,
      JSON.stringify({ sourceType, sourceId }),
      OPEN_VIKING_SYNC_MAX_ATTEMPTS,
      timestamp,
      timestamp,
      timestamp,
      sourceType,
      sourceId,
    )
  }
}
