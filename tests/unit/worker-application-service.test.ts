import { describe, expect, it } from 'vitest'
import { WorkerApplicationService } from '../../server/application/tasks/WorkerApplicationService'
import type { TaskJob } from '../../server/domain/tasks/TaskJob'
import type { Clock } from '../../server/ports/Clock'
import type { TaskHandler, TaskJobRepository } from '../../server/ports/TaskPorts'
import { TaskExecutionError } from '../../server/ports/TaskPorts'

/** 测试使用的固定时钟。 */
const clock: Clock = {
  /** @returns 固定 UTC Unix 毫秒。 */
  now: () => 5_000,
}

/** 测试任务。 */
const job: TaskJob = {
  id: 'job-1',
  type: 'test',
  payloadJson: '{}',
  status: 'running',
  attemptCount: 1,
  maxAttempts: 2,
  leaseUntil: 65_000,
}

/** 可观察的任务仓储。 */
class ObservableTaskRepository implements TaskJobRepository {
  /** 下一次领取结果。 */
  public next: TaskJob | null = job
  /** 成功标记次数。 */
  public succeeded = 0
  /** 失败标记次数。 */
  public failed = 0
  /** 最近一次失败是否允许重试。 */
  public lastRetryable: boolean | null = null

  /** @returns 固定恢复数量。 */
  async recoverExpired(): Promise<number> {
    return 2
  }

  /** @returns 当前下一任务并清空。 */
  async claimNext(): Promise<TaskJob | null> {
    const claimed = this.next
    this.next = null
    return claimed
  }

  /** @returns 无返回值。 */
  async markSucceeded(): Promise<void> {
    this.succeeded += 1
  }

  /** @param _jobId 任务标识。 @param _error 安全错误。 @param _timestamp 时间。 @param retryable 是否允许重试。 @returns 固定未重新排队。 */
  async markFailed(_jobId: string, _error: string, _timestamp: number, retryable: boolean): Promise<boolean> {
    this.failed += 1
    this.lastRetryable = retryable
    return false
  }
}

/**
 * 创建使用指定处理器的 Worker 应用服务。
 * @param repository 可观察任务仓储。
 * @param handler 测试任务处理器。
 * @returns 被测 Worker 应用服务。
 */
function createService(repository: ObservableTaskRepository, handler: TaskHandler): WorkerApplicationService {
  return new WorkerApplicationService({
    taskJobRepository: repository,
    taskHandler: handler,
    clock,
    leaseDurationMs: 60_000,
  })
}

describe('WorkerApplicationService', () => {
  it('恢复租约过期任务', async () => {
    const repository = new ObservableTaskRepository()
    const service = createService(repository, { execute: async () => undefined })

    await expect(service.recoverExpiredJobs()).resolves.toBe(2)
  })

  it('只通过处理器执行任务并标记成功', async () => {
    const repository = new ObservableTaskRepository()
    const service = createService(repository, { execute: async () => undefined })

    await expect(service.executeNext()).resolves.toEqual({ handled: true, jobId: 'job-1', succeeded: true })
    expect(repository.succeeded).toBe(1)
    expect(repository.failed).toBe(0)
  })

  it('捕获处理器错误并标记任务失败', async () => {
    const repository = new ObservableTaskRepository()
    const service = createService(repository, {
      /** @throws Error 模拟业务处理失败。 */
      execute: async () => { throw new Error('测试失败') },
    })

    await expect(service.executeNext()).resolves.toEqual({ handled: true, jobId: 'job-1', succeeded: false })
    expect(repository.succeeded).toBe(0)
    expect(repository.failed).toBe(1)
    expect(repository.lastRetryable).toBe(true)
  })

  it('将处理器声明的不可重试错误传给任务仓储', async () => {
    const repository = new ObservableTaskRepository()
    const service = createService(repository, {
      /** @throws TaskExecutionError 模拟不可重试业务错误。 */
      execute: async () => { throw new TaskExecutionError('输入不可恢复', false) },
    })

    await service.executeNext()
    expect(repository.lastRetryable).toBe(false)
  })

  it('无任务时不调用任何完成写入', async () => {
    const repository = new ObservableTaskRepository()
    repository.next = null
    const service = createService(repository, { execute: async () => undefined })

    await expect(service.executeNext()).resolves.toEqual({ handled: false, jobId: null, succeeded: null })
    expect(repository.succeeded).toBe(0)
    expect(repository.failed).toBe(0)
  })
})
