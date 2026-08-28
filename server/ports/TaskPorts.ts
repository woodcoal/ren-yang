import type { TaskJob } from '../domain/tasks/TaskJob'

/** 任务数据访问端口。 */
export interface TaskJobRepository {
  /**
   * 恢复租约已过期的运行中任务。
   * @param timestamp 当前 UTC Unix 毫秒。
   * @returns 被重新排队或标记失败的任务数量。
   */
  recoverExpired(timestamp: number): Promise<number>

  /**
   * 原子领取下一项可运行任务。
   * @param timestamp 当前 UTC Unix 毫秒。
   * @param leaseDurationMs 租约持续时间。
   * @returns 成功领取的任务；无任务时返回 null。
   */
  claimNext(timestamp: number, leaseDurationMs: number): Promise<TaskJob | null>

  /**
   * 标记任务成功完成。
   * @param jobId 任务标识。
   * @param timestamp 完成时间。
   * @returns 无返回值。
   */
  markSucceeded(jobId: string, timestamp: number): Promise<void>

  /**
   * 标记任务执行失败。
   * @param jobId 任务标识。
   * @param error 已脱敏的失败原因。
   * @param timestamp 失败时间。
   * @returns 无返回值。
   */
  markFailed(jobId: string, error: string, timestamp: number): Promise<void>
}

/** 任务业务处理端口。 */
export interface TaskHandler {
  /**
   * 执行已经领取的任务，不负责直接更新任务表。
   * @param job 已领取任务的稳定快照。
   * @returns 无返回值；失败时抛出已脱敏或可安全归一化的异常。
   */
  execute(job: TaskJob): Promise<void>
}

/** Worker 对健康检查公开的只读状态。 */
export interface WorkerStatusReader {
  /**
   * 读取当前进程内 Worker 状态。
   * @returns Worker 启动、执行和错误摘要。
   */
  getStatus(): WorkerStatusSnapshot
}

/** Worker 的只读健康状态。 */
export interface WorkerStatusSnapshot {
  /** Worker 是否已启动并允许轮询。 */
  running: boolean
  /** 当前正在执行的任务标识。 */
  activeJobId: string | null
  /** 最后一次轮询时间。 */
  lastPollAt: number | null
  /** 最近一次已脱敏错误。 */
  lastError: string | null
}
