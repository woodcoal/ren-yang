import type { ListHistoryPageInput } from '../../../shared/schemas/history'
import type { ClearOpenVikingHistoryResult, HistoryPageView } from '../../../shared/types/history'
import type { HistoryRepository } from '../../ports/HistoryRepository'

/** 任务记录页应用服务依赖。 */
export interface HistoryApplicationServiceDependencies {
  /** 统一任务记录只读仓储。 */
  history: HistoryRepository
}

/** 编排生成运行与分析批次的统一分页查询。 */
export class HistoryApplicationService {
  /**
   * 创建任务记录应用服务。
   * @param dependencies 统一任务记录只读依赖。
   */
  constructor(private readonly dependencies: HistoryApplicationServiceDependencies) {}

  /**
   * 分页读取符合筛选条件的统一任务记录。
   * @param input 已校验的页码、每页数量和筛选条件。
   * @returns 当前页任务、准确总数和服务端修正后的页码。
   */
  async listPage(input: ListHistoryPageInput): Promise<HistoryPageView> {
    return await this.dependencies.history.listPage(input)
  }

  /**
   * 清理已经结束的 OpenViking 后台任务记录。
   * @returns 实际删除数量；活动任务、生成运行和分析批次始终保留。
   */
  async clearTerminalContextTasks(): Promise<ClearOpenVikingHistoryResult> {
    return await this.dependencies.history.clearTerminalOpenVikingTasks()
  }
}
