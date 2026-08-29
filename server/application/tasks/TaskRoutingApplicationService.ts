import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { TaskHandler } from '../../ports/TaskPorts'

/** 只在应用层按持久任务类型路由到对应业务应用服务。 */
export class TaskRoutingApplicationService implements TaskHandler {
  /**
   * 创建任务路由应用服务。
   * @param generation 生成业务任务处理器。
   * @param feedback 反馈与评测业务任务处理器。
   * @param contextSynchronization OpenViking 增量同步任务处理器。
   */
  constructor(
    private readonly generation: TaskHandler,
    private readonly feedback: TaskHandler,
    private readonly contextSynchronization: TaskHandler,
  ) {}

  /**
   * 按稳定任务类型调用且只调用一个应用服务。
   * @param job Worker 已领取任务。
   * @returns 目标业务任务结束时完成。
   */
  async execute(job: TaskJob): Promise<void> {
    if (job.type === 'evaluate_proposal') await this.feedback.execute(job)
    else if (job.type === 'sync_context_source') await this.contextSynchronization.execute(job)
    else await this.generation.execute(job)
  }
}
