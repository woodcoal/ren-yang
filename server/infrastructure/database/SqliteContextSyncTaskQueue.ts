import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { ContextSyncTaskQueue } from '../../ports/ContextSyncTaskQueue'

/** 使用现有持久任务表排队 OpenViking 单资料同步。 */
export class SqliteContextSyncTaskQueue implements ContextSyncTaskQueue {
  /**
   * 创建 SQLite 增量同步任务队列。
   * @param client 已迁移 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /**
   * 创建最多尝试三次且不绑定生成运行的同步任务；同资料已有排队任务时复用该任务。
   * @param sourceId 资料 UUID。
   * @param taskId 新任务 UUID。
   * @param timestamp 创建时间，UTC Unix 毫秒。
   * @returns 无返回值。
   */
  async enqueueSourceSynchronization(sourceId: string, taskId: string, timestamp: number): Promise<void> {
    this.client.prepare(`
      INSERT INTO task_jobs (
        id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at
      ) SELECT ?, NULL, 'sync_context_source', ?, 'queued', 0, 3, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM task_jobs
        WHERE type = 'sync_context_source' AND status = 'queued'
          AND json_extract(payload_json, '$.sourceId') = ?
      )
    `).run(taskId, JSON.stringify({ sourceId }), timestamp, timestamp, sourceId)
  }

  /** @param sourceType 生成运行或反馈。 @param sourceId 本地 UUID。 @param taskId 新任务 UUID。 @param timestamp 创建时间。 @returns 无返回值；同来源已有待处理任务时保持幂等。 */
  async enqueueSessionSynchronization(sourceType: 'run' | 'feedback', sourceId: string, taskId: string, timestamp: number): Promise<void> {
    this.client.prepare(`
      INSERT INTO task_jobs (
        id, run_id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at
      ) SELECT ?, NULL, 'sync_openviking_session', ?, 'queued', 0, 3, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM task_jobs
        WHERE type = 'sync_openviking_session' AND status IN ('queued', 'running')
          AND json_extract(payload_json, '$.sourceType') = ?
          AND json_extract(payload_json, '$.sourceId') = ?
      )
    `).run(taskId, JSON.stringify({ sourceType, sourceId }), timestamp, timestamp, sourceType, sourceId)
  }
}
