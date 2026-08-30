import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { z } from 'zod'
import { executeController } from '../../../../presentation/http/controller'

/** 同步日志分页接口允许的查询参数。 */
const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine(value => [5, 10, 20, 50, 100].includes(value)).default(10),
})

/**
 * 返回登录管理员可见的外部上下文同步日志分页结果。
 * @param event 当前 H3 请求事件。
 * @returns 最近更新在前的统一同步日志分页响应。
 */
async function handleSyncRecordPage(event: H3Event) {
  return await executeController(event, async () => {
    const query = querySchema.parse(getQuery(event))
    return await event.context.applicationServices.contextSynchronization.listSyncRecordsPage({
      page: query.page,
      pageSize: query.pageSize as 5 | 10 | 20 | 50 | 100,
    })
  })
}

export default defineEventHandler(handleSyncRecordPage)
