import type { ListHistoryPageInput } from '../../shared/schemas/history'
import type { HistoryPageView } from '../../shared/types/history'

/** 统一读取生成运行与分析批次的任务记录端口。 */
export interface HistoryRepository {
  /**
   * 按统一创建时间顺序分页读取任务记录。
   * @param input 已校验的分页与筛选参数。
   * @returns 当前页记录、准确总数和服务端修正后的页码。
   */
  listPage(input: ListHistoryPageInput): Promise<HistoryPageView>
}
