import type { WorkerStatusReader, WorkerStatusSnapshot } from '../ports/TaskPorts'
import type { InternalWorker } from './InternalWorker'

/** 聚合同一进程内相互独立的任务 Worker，并保持既有健康状态契约。 */
export class InternalWorkerGroup implements WorkerStatusReader {
  /**
   * 创建至少包含两个执行通道的 Worker 分组。
   * @param workers 按健康状态展示优先级排列的 Worker；前台通道应位于首位。
   */
  constructor(private readonly workers: readonly [InternalWorker, InternalWorker, ...InternalWorker[]]) {}

  /**
   * 依次启动全部 Worker；任一启动失败时停止已经启动的 Worker。
   * @returns 全部 Worker 均已开始后台轮询时结束。
   */
  async start(): Promise<void> {
    const started: InternalWorker[] = []
    try {
      for (const worker of this.workers) {
        await worker.start()
        started.push(worker)
      }
    }
    catch (error: unknown) {
      await Promise.all(started.map(async worker => await worker.stop()))
      throw error
    }
  }

  /**
   * 同时停止全部 Worker 继续领取任务，并等待各自当前任务结束。
   * @returns 全部 Worker 均已停止时结束。
   */
  async stop(): Promise<void> {
    await Promise.all(this.workers.map(async worker => await worker.stop()))
  }

  /**
   * 聚合全部 Worker 状态而不改变公开健康响应结构。
   * @returns 分组运行状态、当前任务、最后轮询时间和最近错误摘要。
   */
  getStatus(): WorkerStatusSnapshot {
    const snapshots = this.workers.map(worker => worker.getStatus())
    const pollTimes = snapshots
      .map(snapshot => snapshot.lastPollAt)
      .filter((timestamp): timestamp is number => timestamp !== null)

    return {
      running: snapshots.every(snapshot => snapshot.running),
      activeJobId: snapshots.find(snapshot => snapshot.activeJobId !== null)?.activeJobId ?? null,
      lastPollAt: pollTimes.length > 0 ? Math.max(...pollTimes) : null,
      lastError: snapshots.find(snapshot => snapshot.lastError !== null)?.lastError ?? null,
    }
  }
}
