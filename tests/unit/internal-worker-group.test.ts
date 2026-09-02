import { describe, expect, it, vi } from 'vitest'
import type { WorkerApplicationService, WorkerTickResult } from '../../server/application/tasks/WorkerApplicationService'
import { InternalWorker } from '../../server/worker/InternalWorker'
import { InternalWorkerGroup } from '../../server/worker/InternalWorkerGroup'

/** 创建可由测试主动结束的长时间任务。 */
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

describe('内部 Worker 分组', () => {
  it('OpenViking 通道阻塞时前台通道仍能独立轮询', async () => {
    const openVikingExecution = createDeferredExecution()
    let foregroundPolls = 0
    let openVikingStarted = false
    const foreground = new InternalWorker({
      recoverExpiredJobs: async () => 0,
      executeNext: async () => {
        foregroundPolls += 1
        return { handled: false, jobId: null, succeeded: null }
      },
    } as WorkerApplicationService, 10)
    const openViking = new InternalWorker({
      recoverExpiredJobs: async () => 0,
      executeNext: async () => {
        openVikingStarted = true
        return await openVikingExecution.promise
      },
    } as WorkerApplicationService, 60_000)
    const group = new InternalWorkerGroup([foreground, openViking])

    await group.start()
    try {
      await vi.waitFor(() => expect(openVikingStarted).toBe(true))
      const pollsAtOpenVikingStart = foregroundPolls
      await vi.waitFor(() => expect(foregroundPolls).toBeGreaterThan(pollsAtOpenVikingStart))
      expect(group.getStatus().running).toBe(true)
    }
    finally {
      openVikingExecution.resolve({ handled: true, jobId: 'openviking-job', succeeded: true })
      await group.stop()
    }
  })
})
