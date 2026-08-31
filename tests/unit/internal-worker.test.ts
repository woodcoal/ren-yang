import { describe, expect, it } from 'vitest'
import type { WorkerApplicationService } from '../../server/application/tasks/WorkerApplicationService'
import type { WorkerTickResult } from '../../server/application/tasks/WorkerApplicationService'
import { InternalWorker } from '../../server/worker/InternalWorker'

/**
 * 创建由测试显式解除的 Promise。
 * @returns Promise 及其完成函数，用于模拟长时间运行的外部同步任务。
 */
function createDeferredExecution(): {
  promise: Promise<WorkerTickResult>
  resolve: (result: WorkerTickResult) => void
} {
  let resolveExecution: (result: WorkerTickResult) => void = () => undefined
  const promise = new Promise<WorkerTickResult>((resolve) => {
    resolveExecution = resolve
  })
  return { promise, resolve: resolveExecution }
}

describe('InternalWorker', () => {
  it('启动不等待首个长时间任务完成', async () => {
    const execution = createDeferredExecution()
    const service = {
      /** @returns 固定没有过期任务。 */
      recoverExpiredJobs: async () => 0,
      /** @returns 由测试控制完成时间的首轮任务。 */
      executeNext: async () => await execution.promise,
    } as WorkerApplicationService
    const worker = new InternalWorker(service, 1_000)

    const startPromise = worker.start()
    const startedWithoutWaiting = await Promise.race([
      startPromise.then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 20)),
    ])

    execution.resolve({ handled: true, jobId: 'slow-openviking-task', succeeded: true })
    await startPromise
    await worker.stop()

    expect(startedWithoutWaiting).toBe(true)
  })
})
