import type { Database as BetterSqliteDatabase, RunResult } from 'better-sqlite3'
import type { TaskJob } from '../../domain/tasks/TaskJob'
import { calculateOpenVikingRetryDelay, OPEN_VIKING_SYNC_MAX_ATTEMPTS } from '../../domain/context/OpenVikingRetryPolicy'
import type { ContextSyncTaskQueue } from '../../ports/ContextSyncTaskQueue'
import type { TaskJobRepository } from '../../ports/TaskPorts'

/** OpenViking 专属 outbox 的查询行。 */
interface OpenVikingSyncOutboxRow {
  id: string
  type: string
  payload_json: string
  attempt_count: number
  max_attempts: number
  lease_until: number | null
}

/** 使用 SQLite 专属 outbox 保存尚未送达 OpenViking 的可恢复同步意图。 */
export class SqliteContextSyncTaskQueue implements ContextSyncTaskQueue, TaskJobRepository {
  /**
   * 创建 SQLite OpenViking 同步意图 outbox。
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
      INSERT INTO openviking_sync_outbox (
        id, type, payload_json, status, attempt_count, max_attempts, available_at, created_at, updated_at
      ) SELECT ?, 'sync_openviking_users', '{}', 'queued', 0, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM openviking_sync_outbox
        WHERE type = 'sync_openviking_users' AND status IN ('queued', 'running')
      )
    `).run(taskId, OPEN_VIKING_SYNC_MAX_ATTEMPTS, timestamp, timestamp, timestamp)
  }

  /**
   * 保存最多尝试十次且不绑定生成运行的同步意图；同资料已有待处理意图时复用并提前到更早时间。
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
        UPDATE openviking_sync_outbox SET available_at = MIN(available_at, ?), updated_at = ?
        WHERE type = 'sync_context_source' AND status IN ('queued', 'running')
          AND COALESCE(json_extract(payload_json, '$.entityType'), 'source_material') = ?
          AND json_extract(payload_json, '$.sourceId') = ?
      `).run(availableAt, timestamp, entityType, sourceId)
      if (existing.changes > 0) return
      this.client.prepare(`
        INSERT INTO openviking_sync_outbox (
          id, type, payload_json, status, attempt_count, max_attempts, available_at, created_at, updated_at
        ) VALUES (?, 'sync_context_source', ?, 'queued', 0, ?, ?, ?, ?)
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
      INSERT INTO openviking_sync_outbox (
        id, type, payload_json, status, attempt_count, max_attempts, available_at, created_at, updated_at
      ) SELECT ?, 'sync_openviking_session', ?, 'queued', 0, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM openviking_sync_outbox
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

  /**
   * 恢复进程退出时留下的过期意图；已耗尽尝试的意图直接移除。
   * @param timestamp 当前 UTC Unix 毫秒。
   * @returns 重新排队或移除的意图数量。
   */
  async recoverExpired(timestamp: number): Promise<number> {
    return this.client.transaction(() => {
      const removed = this.client.prepare(`
        DELETE FROM openviking_sync_outbox
        WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until <= ?
          AND attempt_count >= max_attempts
      `).run(timestamp)
      const recovered = this.client.prepare(`
        UPDATE openviking_sync_outbox
        SET status = 'queued', lease_until = NULL,
          last_error = '进程退出导致租约过期，同步意图已重新排队', updated_at = ?
        WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until <= ?
          AND attempt_count < max_attempts
      `).run(timestamp, timestamp)
      return removed.changes + recovered.changes
    }).immediate()
  }

  /**
   * 原子领取最早可运行的 OpenViking 同步意图。
   * @param timestamp 当前 UTC Unix 毫秒。
   * @param leaseDurationMs 租约持续时间。
   * @returns 兼容通用 Worker 的运行中意图；无可执行项时返回 null。
   */
  async claimNext(timestamp: number, leaseDurationMs: number): Promise<TaskJob | null> {
    return this.client.transaction((): TaskJob | null => {
      const row = this.client.prepare(`
        SELECT id, type, payload_json, attempt_count, max_attempts, lease_until
        FROM openviking_sync_outbox
        WHERE status = 'queued' AND attempt_count < max_attempts AND available_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM openviking_sync_runtime
            WHERE id = 'openviking_sync_runtime' AND state = 'degraded'
              AND (retry_after IS NULL OR retry_after > ?)
          )
        ORDER BY available_at ASC, created_at ASC, id ASC
        LIMIT 1
      `).get(timestamp, timestamp) as OpenVikingSyncOutboxRow | undefined
      if (!row) return null
      const leaseUntil = timestamp + leaseDurationMs
      const claimed = this.client.prepare(`
        UPDATE openviking_sync_outbox
        SET status = 'running', attempt_count = attempt_count + 1,
          lease_until = ?, updated_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(leaseUntil, timestamp, row.id) as RunResult
      if (claimed.changes !== 1) return null
      return {
        id: row.id,
        type: row.type,
        payloadJson: row.payload_json,
        status: 'running',
        attemptCount: row.attempt_count + 1,
        maxAttempts: row.max_attempts,
        leaseUntil,
      }
    }).immediate()
  }

  /**
   * OpenViking 已成功受理并完成本地回写后移除同步意图。
   * @param jobId 同步意图标识。
   * @param _timestamp 完成时间；outbox 不保存历史，仅用于统一端口。
   * @returns 无返回值。
   */
  async markSucceeded(jobId: string, _timestamp: number): Promise<void> {
    this.client.prepare(`DELETE FROM openviking_sync_outbox WHERE id = ? AND status = 'running'`).run(jobId)
  }

  /**
   * 可重试失败按固定退避重新排队；不可重试或耗尽次数时移除意图。
   * @param jobId 同步意图标识。
   * @param error 已脱敏失败摘要。
   * @param timestamp 失败时间。
   * @param retryable 本次失败是否允许自动重试。
   * @returns 是否已重新排队。
   */
  async markFailed(jobId: string, error: string, timestamp: number, retryable: boolean): Promise<boolean> {
    return this.client.transaction(() => {
      const item = this.client.prepare(`
        SELECT attempt_count, max_attempts FROM openviking_sync_outbox
        WHERE id = ? AND status = 'running'
      `).get(jobId) as { attempt_count: number, max_attempts: number } | undefined
      if (!item) return false
      const willRetry = retryable && item.attempt_count < item.max_attempts
      if (!willRetry) {
        this.client.prepare(`DELETE FROM openviking_sync_outbox WHERE id = ?`).run(jobId)
        return false
      }
      this.client.prepare(`
        UPDATE openviking_sync_outbox
        SET status = 'queued', available_at = ?, lease_until = NULL, last_error = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `).run(timestamp + calculateOpenVikingRetryDelay(item.attempt_count), error.slice(0, 1000), timestamp, jobId)
      return true
    }).immediate()
  }
}
