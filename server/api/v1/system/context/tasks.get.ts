import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { z } from 'zod'
import { executeController } from '../../../../presentation/http/controller'

/** 外部上下文提供器官方任务日志查询限制。 */
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/**
 * 返回登录管理员可见的外部上下文官方任务日志。
 * @param event 当前 H3 请求事件。
 * @returns 各受管 User 合并后的最新任务记录。
 */
async function handleContextTasks(event: H3Event) {
  return await executeController(event, async () => {
    const query = querySchema.parse(getQuery(event))
    return await event.context.applicationServices.contextSynchronization.listRemoteTasks(query.limit)
  })
}

export default defineEventHandler(handleContextTasks)
