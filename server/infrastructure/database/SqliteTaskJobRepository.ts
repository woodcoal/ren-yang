import type { Database as BetterSqliteDatabase, RunResult } from 'better-sqlite3'
import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { TaskJobRepository, TaskQueueStatusReader } from '../../ports/TaskPorts'
import { calculateOpenVikingRetryDelay } from '../../domain/context/OpenVikingRetryPolicy'

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
export class SqliteTaskJobRepository implements TaskJobRepository, TaskQueueStatusReader {
  /**
   * 创建任务仓储并预编译固定参数化语句。
   * @param client 已初始化的原生 SQLite 客户端。
   */
  constructor(private readonly client: BetterSqliteDatabase) {}

  /**
   * 统计排队、运行中和等待协作取消的持久任务。
   * @returns 管理界面使用的精确任务队列摘要。
   */
  async getPendingSummary(): Promise<{ userQueued: number, queued: number, running: number, cancelRequested: number, total: number }> {
    const row = this.client.prepare(`
      SELECT
        COUNT(*) FILTER (
          WHERE status = 'queued'
            AND type IN ('assess_interest', 'plan_document', 'execute_document', 'execute_block', 'analyze_learning')
        ) AS user_queued,
        COUNT(*) FILTER (WHERE status = 'queued') AS queued,
        COUNT(*) FILTER (WHERE status = 'running') AS running,
        COUNT(*) FILTER (WHERE status = 'cancel_requested') AS cancel_requested
      FROM task_jobs
      WHERE status IN ('queued', 'running', 'cancel_requested')
    `).get() as { user_queued: number, queued: number, running: number, cancel_requested: number }
    return {
      userQueued: row.user_queued,
      queued: row.queued,
      running: row.running,
      cancelRequested: row.cancel_requested,
      total: row.queued + row.running + row.cancel_requested,
    }
  }

  /**
   * 恢复租约过期任务；仍有尝试次数的重新排队，否则终止。
   * @param timestamp 当前 UTC Unix 毫秒。
   * @returns 处理的过期任务数量。
   */
  async recoverExpired(timestamp: number): Promise<number> {
    return this.client.transaction(() => {
      const canceled = this.client.prepare(`
        SELECT DISTINCT run_id FROM task_jobs
        WHERE status = 'cancel_requested' AND lease_until IS NOT NULL AND lease_until <= ? AND run_id IS NOT NULL
      `).all(timestamp) as Array<{ run_id: string }>
      for (const item of canceled) {
        const batch = this.findInterestBatchId(item.run_id)
        if (batch) {
          this.client.prepare(`
            UPDATE generation_runs SET status = 'canceled', completed_at = ?, updated_at = ?
            WHERE id IN (SELECT run_id FROM interest_batch_items WHERE batch_id = ?)
              AND status IN ('planning', 'queued', 'running')
          `).run(timestamp, timestamp, batch)
        }
        else {
          this.client.prepare(`
            UPDATE generation_runs SET status = 'canceled', completed_at = ?, updated_at = ?
            WHERE id = ? AND status IN ('planning', 'queued', 'running')
          `).run(timestamp, timestamp, item.run_id)
        }
      }
      const canceledJobs = this.client.prepare(`
        UPDATE task_jobs SET status = 'canceled', lease_until = NULL, heartbeat_at = NULL,
          last_error = '进程退出时任务已请求取消', updated_at = ?
        WHERE status = 'cancel_requested' AND lease_until IS NOT NULL AND lease_until <= ?
      `).run(timestamp, timestamp)
      const expired = this.client.prepare(`
        SELECT run_id, type, attempt_count, max_attempts FROM task_jobs
        WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until <= ? AND run_id IS NOT NULL
      `).all(timestamp) as Array<{ run_id: string, type: string, attempt_count: number, max_attempts: number }>
      for (const item of expired) {
        const batch = item.type === 'assess_interest' ? this.findInterestBatchId(item.run_id) : null
        if (item.attempt_count < item.max_attempts) {
          if (batch) {
            this.client.prepare(`
              UPDATE generation_runs SET status = 'queued', updated_at = ?
              WHERE id IN (SELECT run_id FROM interest_batch_items WHERE batch_id = ?) AND status = 'running'
            `).run(timestamp, batch)
          }
          else {
            this.client.prepare(`
              UPDATE generation_runs SET status = ?, updated_at = ? WHERE id = ? AND status = 'running'
            `).run(item.type === 'plan_document' ? 'planning' : 'queued', timestamp, item.run_id)
          }
        }
        else {
          if (batch) {
            this.client.prepare(`
              UPDATE generation_runs SET status = 'failed', error_code = 'TASK_LEASE_EXHAUSTED',
                error_message = '任务执行中断且已达到最大尝试次数', completed_at = ?, updated_at = ?
              WHERE id IN (SELECT run_id FROM interest_batch_items WHERE batch_id = ?) AND status = 'running'
            `).run(timestamp, timestamp, batch)
          }
          else {
            this.client.prepare(`
              UPDATE generation_runs SET status = 'failed', error_code = 'TASK_LEASE_EXHAUSTED',
                error_message = '任务执行中断且已达到最大尝试次数', completed_at = ?, updated_at = ?
              WHERE id = ? AND status = 'running'
            `).run(timestamp, timestamp, item.run_id)
          }
        }
      }
      const recoveredJobs = this.client.prepare(`
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
      return canceledJobs.changes + recoveredJobs.changes
    }).immediate()
  }

  /**
   * 查找任务锚定运行所属的兴趣批次。
   * @param runId 任务锚定运行 UUID。
   * @returns 所属兴趣批次 UUID；普通运行返回 null。
   */
  private findInterestBatchId(runId: string): string | null {
    const value = this.client.prepare('SELECT batch_id FROM interest_batch_items WHERE run_id = ?').get(runId) as { batch_id: string } | undefined
    return value?.batch_id ?? null
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
        WHERE status = 'queued' AND attempt_count < max_attempts AND available_at <= ?
          AND (
            type NOT IN ('sync_context_source', 'sync_openviking_users', 'sync_openviking_session')
            OR NOT EXISTS (
              SELECT 1 FROM openviking_sync_runtime
              WHERE id = 'openviking_sync_runtime' AND state = 'degraded'
                AND (retry_after IS NULL OR retry_after > ?)
            )
          )
        ORDER BY available_at ASC, created_at ASC, id ASC
        LIMIT 1
      `).get(timestamp, timestamp) as TaskJobRow | undefined

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
   * 保存本次失败；可重试且次数未耗尽时重新排队，否则终止。
   * @param jobId 任务标识。
   * @param error 已脱敏错误。
   * @param timestamp 失败时间。
   * @param retryable 本次错误是否允许自动重试。
   * @returns 是否已重新排队。
   */
  async markFailed(jobId: string, error: string, timestamp: number, retryable: boolean): Promise<boolean> {
    return this.client.transaction(() => {
      const job = this.client.prepare(`
        SELECT type, attempt_count, max_attempts FROM task_jobs WHERE id = ? AND status = 'running'
      `).get(jobId) as { type: string, attempt_count: number, max_attempts: number } | undefined
      if (!job) return false
      const willRetry = retryable && job.attempt_count < job.max_attempts
      const retryAt = willRetry && isOpenVikingTask(job.type)
        ? timestamp + calculateOpenVikingRetryDelay(job.attempt_count)
        : timestamp
      this.client.prepare(`
        UPDATE task_jobs
        SET status = ?, available_at = ?, lease_until = NULL, heartbeat_at = NULL, last_error = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `).run(willRetry ? 'queued' : 'failed', retryAt, error.slice(0, 1000), timestamp, jobId)
      return willRetry
    }).immediate()
  }
}

/** @param type 持久任务类型。 @returns 是否属于 OpenViking 外部同步任务。 */
function isOpenVikingTask(type: string): boolean {
  return type === 'sync_context_source' || type === 'sync_openviking_users' || type === 'sync_openviking_session'
}
