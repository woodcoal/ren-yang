import type { TaskJob } from '../../domain/tasks/TaskJob'
import type { TaskHandler } from '../../ports/TaskPorts'

/** 阶段一使用的拒绝型任务处理器，防止未知任务被静默成功。 */
export class UnsupportedTaskHandler implements TaskHandler {
  /**
   * 拒绝尚未注册业务处理器的任务。
   * @param job 已领取的任务快照。
   * @returns 不正常返回。
   * @throws Error 始终抛出包含任务类型的安全错误。
   */
  async execute(job: TaskJob): Promise<void> {
    throw new Error(`未注册任务处理器：${job.type}`)
  }
}
