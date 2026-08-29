import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { z } from 'zod'
import { executeController } from '../../../presentation/http/controller'

/** 审计列表查询限制。 */
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

/**
 * 返回登录管理员可见的关键动作审计历史。
 * @param event 当前 H3 请求事件。
 * @returns 新记录在前的统一审计响应。
 */
async function handleAuditList(event: H3Event) {
  return await executeController(event, async () => {
    const query = querySchema.parse(getQuery(event))
    return await event.context.applicationServices.system.listAuditEvents(query.limit)
  })
}

export default defineEventHandler(handleAuditList)
