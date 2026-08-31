import type { WorkerApplicationService } from '../application/tasks/WorkerApplicationService'
import type { WorkerStatusReader, WorkerStatusSnapshot } from '../ports/TaskPorts'

/** 同一 Node.js 进程内运行的单 Worker 轮询器。 */
export class InternalWorker implements WorkerStatusReader {
  /** 当前是否允许继续轮询。 */
  private running = false
  /** 当前轮询定时器。 */
  private timer: NodeJS.Timeout | null = null
  /** 尚未结束的轮询 Promise，用于优雅退出。 */
  private activePoll: Promise<void> | null = null
  /** 最近一次轮询时间。 */
  private lastPollAt: number | null = null
  /** 当前任务标识；阶段一没有业务任务时保持 null。 */
  private activeJobId: string | null = null
  /** 最近一次安全错误摘要。 */
  private lastError: string | null = null

  /**
   * 创建内部 Worker。
   * @param service 只通过应用服务领取和执行任务。
   * @param pollIntervalMs 空闲轮询间隔。
   */
  constructor(
    private readonly service: WorkerApplicationService,
    private readonly pollIntervalMs: number,
  ) {}

  /**
   * 恢复过期租约并启动单一轮询循环。
   * @returns 轮询器已启动时结束，不等待首个业务任务完成。
   */
  async start(): Promise<void> {
    if (this.running) {
      return
    }

    await this.service.recoverExpiredJobs()
    this.running = true
    this.timer = setInterval(() => {
      void this.poll()
    }, this.pollIntervalMs)
    // OpenViking 等外部任务可能运行数分钟，首轮必须转入后台，避免阻塞 Nitro 请求钩子注册。
    void this.poll()
  }

  /**
   * 停止领取新任务并等待当前轮询结束。
   * @returns 无返回值。
   */
  async stop(): Promise<void> {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.activePoll
  }

  /**
   * 返回不允许外部修改的 Worker 状态副本。
   * @returns 当前 Worker 健康状态。
   */
  getStatus(): WorkerStatusSnapshot {
    return {
      running: this.running,
      activeJobId: this.activeJobId,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
    }
  }

  /**
   * 防止轮询重入，并通过应用服务处理最多一个任务。
   * @returns 当前轮询完成时结束。
   */
  private async poll(): Promise<void> {
    if (!this.running || this.activePoll) {
      return
    }

    this.activePoll = this.executePoll()
    try {
      await this.activePoll
    }
    finally {
      this.activePoll = null
    }
  }

  /**
   * 执行一次真实轮询并更新健康状态。
   * @returns 当前轮询完成时结束。
   */
  private async executePoll(): Promise<void> {
    this.lastPollAt = Date.now()
    try {
      const result = await this.service.executeNext()
      this.activeJobId = result.jobId
      this.lastError = result.handled && result.succeeded === false ? '最近任务执行失败' : null
    }
    catch (error: unknown) {
      this.lastError = error instanceof Error ? error.message.slice(0, 500) : '未知 Worker 错误'
    }
    finally {
      this.activeJobId = null
    }
  }
}
