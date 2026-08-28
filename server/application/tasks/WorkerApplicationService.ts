import type { Clock } from '../../ports/Clock'
import type { TaskHandler, TaskJobRepository } from '../../ports/TaskPorts'
import { TaskExecutionError } from '../../ports/TaskPorts'

/** Worker 应用服务的依赖。 */
export interface WorkerApplicationServiceDependencies {
  /** 任务数据访问端口。 */
  taskJobRepository: TaskJobRepository
  /** 任务业务处理端口。 */
  taskHandler: TaskHandler
  /** 可测试的系统时钟。 */
  clock: Clock
  /** 单次任务租约长度。 */
  leaseDurationMs: number
}

/** Worker 每次轮询的执行结果。 */
export interface WorkerTickResult {
  /** 本次是否领取到任务。 */
  handled: boolean
  /** 领取到的任务标识。 */
  jobId: string | null
  /** 任务是否成功完成。 */
  succeeded: boolean | null
}

/** 编排任务恢复、领取、业务执行和最终状态写入。 */
export class WorkerApplicationService {
  /**
   * 创建 Worker 应用服务。
   * @param dependencies 任务数据、处理器、时间和租约配置。
   */
  constructor(private readonly dependencies: WorkerApplicationServiceDependencies) {}

  /**
   * 恢复进程异常退出后租约已过期的任务。
   * @returns 被恢复或终止的任务数量。
   */
  async recoverExpiredJobs(): Promise<number> {
    return await this.dependencies.taskJobRepository.recoverExpired(this.dependencies.clock.now())
  }

  /**
   * 原子领取并执行最多一个任务。
   * @returns 本次轮询是否处理任务及其结果。
   */
  async executeNext(): Promise<WorkerTickResult> {
    const job = await this.dependencies.taskJobRepository.claimNext(
      this.dependencies.clock.now(),
      this.dependencies.leaseDurationMs,
    )
    if (!job) {
      return { handled: false, jobId: null, succeeded: null }
    }

    try {
      await this.dependencies.taskHandler.execute(job)
      await this.dependencies.taskJobRepository.markSucceeded(job.id, this.dependencies.clock.now())
      return { handled: true, jobId: job.id, succeeded: true }
    }
    catch (error: unknown) {
      const safeError = error instanceof Error ? error.message : '未知任务错误'
      const retryable = error instanceof TaskExecutionError ? error.retryable : true
      await this.dependencies.taskJobRepository.markFailed(job.id, safeError, this.dependencies.clock.now(), retryable)
      return { handled: true, jobId: job.id, succeeded: false }
    }
  }
}
