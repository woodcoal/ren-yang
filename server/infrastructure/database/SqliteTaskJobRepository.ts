import type { Database as BetterSqliteDatabase, RunResult } from 'better-sqlite3'
import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { TaskJobRepository } from '../../ports/TaskPorts'

/** SQLite 查询返回的任务行。 */
interface TaskJobRow {
  id: string
  type: string
  payload_json: string
  status: TaskJob['status']
  attempt_count: number
  max_attempts: number
  lease_until: number | null
}

/** 使用短事务和条件更新实现任务租约。 */
export class SqliteTaskJobRepository implements TaskJobRepository {
  /**
   * 创建任务仓储并预编译固定参数化语句。
   * @param client 已初始化的原生 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /**
   * 恢复租约过期任务；仍有尝试次数的重新排队，否则终止。
   * @param timestamp 当前 UTC Unix 毫秒。
   * @returns 处理的过期任务数量。
   */
  async recoverExpired(timestamp: number): Promise<number> {
    const result = this.client.prepare(`
      UPDATE task_jobs
      SET status = CASE WHEN attempt_count < max_attempts THEN 'queued' ELSE 'failed' END,
          lease_until = NULL,
          heartbeat_at = NULL,
          last_error = CASE
            WHEN attempt_count < max_attempts THEN '进程退出导致租约过期，任务已重新排队'
            ELSE '进程退出导致租约过期，且任务已达到最大尝试次数'
          END,
          updated_at = ?
      WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until <= ?
    `).run(timestamp, timestamp)
    return result.changes
  }

  /**
   * 在 SQLite 立即事务中领取最早的排队任务。
   * @param timestamp 当前 UTC Unix 毫秒。
   * @param leaseDurationMs 租约持续时间。
   * @returns 已领取任务或 null。
   */
  async claimNext(timestamp: number, leaseDurationMs: number): Promise<TaskJob | null> {
    const claimTransaction = this.client.transaction((): TaskJob | null => {
      const row = this.client.prepare(`
        SELECT id, type, payload_json, status, attempt_count, max_attempts, lease_until
        FROM task_jobs
        WHERE status = 'queued' AND attempt_count < max_attempts
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `).get() as TaskJobRow | undefined

      if (!row) {
        return null
      }

      const leaseUntil = timestamp + leaseDurationMs
      const result = this.client.prepare(`
        UPDATE task_jobs
        SET status = 'running',
            attempt_count = attempt_count + 1,
            lease_until = ?,
            heartbeat_at = ?,
            updated_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(leaseUntil, timestamp, timestamp, row.id) as RunResult

      if (result.changes !== 1) {
        return null
      }

      return {
        id: row.id,
        type: row.type,
        payloadJson: row.payload_json,
        status: 'running',
        attemptCount: row.attempt_count + 1,
        maxAttempts: row.max_attempts,
        leaseUntil,
      }
    })

    return claimTransaction.immediate()
  }

  /**
   * 标记运行中任务成功完成并清除租约。
   * @param jobId 任务标识。
   * @param timestamp 完成时间。
   * @returns 无返回值。
   */
  async markSucceeded(jobId: string, timestamp: number): Promise<void> {
    this.client.prepare(`
      UPDATE task_jobs
      SET status = 'succeeded', lease_until = NULL, heartbeat_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(timestamp, jobId)
  }

  /**
   * 标记运行中任务失败并保存已脱敏原因。
   * @param jobId 任务标识。
   * @param error 已脱敏错误。
   * @param timestamp 失败时间。
   * @returns 无返回值。
   */
  async markFailed(jobId: string, error: string, timestamp: number): Promise<void> {
    this.client.prepare(`
      UPDATE task_jobs
      SET status = 'failed', lease_until = NULL, heartbeat_at = NULL, last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).run(error.slice(0, 1000), timestamp, jobId)
  }
}
