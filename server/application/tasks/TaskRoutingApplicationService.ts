import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { TaskHandler } from '../../ports/TaskPorts'
import { TaskExecutionError } from '../../ports/TaskPorts'

/** 只在应用层按持久任务类型路由到对应业务应用服务。 */
export class TaskRoutingApplicationService implements TaskHandler {
  /**
   * 创建任务路由应用服务。
   * @param generation 生成业务任务处理器。
   * @param contextSynchronization OpenViking 增量同步任务处理器。
   * @param analysis 可选成长与记忆分析任务处理器。
   */
  constructor(
    private readonly generation: TaskHandler,
    private readonly contextSynchronization: TaskHandler,
    private readonly analysis?: TaskHandler,
  ) {}

  /**
   * 按稳定任务类型调用且只调用一个应用服务。
   * @param job Worker 已领取任务。
   * @returns 目标业务任务结束时完成。
   */
  async execute(job: TaskJob): Promise<void> {
    if (job.type === 'analyze_learning') {
      if (!this.analysis) throw new TaskExecutionError('学习分析任务处理器未配置', false)
      await this.analysis.execute(job)
    }
    else if (job.type === 'sync_openviking_users' || job.type === 'sync_context_source' || job.type === 'sync_openviking_session') {
      await this.contextSynchronization.execute(job)
    }
    else await this.generation.execute(job)
  }
}
