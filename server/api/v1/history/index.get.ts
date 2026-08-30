import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { listHistoryPageSchema } from '#shared/schemas/history'
import { executeController } from '../../../presentation/http/controller'

/**
 * 分页查询生成运行与分析批次组成的统一任务记录。
 * @param event 当前 H3 请求事件，查询参数包含分页与筛选条件。
 * @returns 包含当前页、总数和总页数的统一任务记录响应。
 */
async function handleListHistoryPage(event: H3Event) {
  return await executeController(event, async () => {
    const input = listHistoryPageSchema.parse(getQuery(event))
    return await event.context.applicationServices.history.listPage(input)
  })
}

export default defineEventHandler(handleListHistoryPage)
