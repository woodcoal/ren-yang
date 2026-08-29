import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { updateWorldsStatusSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 批量修改世界启用状态。
 * @param event 当前 H3 请求事件，请求体包含世界 UUID 集合和统一状态。
 * @returns 去重后的处理世界与新状态响应。
 */
async function handleUpdateWorldsStatus(event: H3Event) {
  return await executeController(event, async () => {
    const input = updateWorldsStatusSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.updateWorldsStatus(input)
  })
}

export default defineEventHandler(handleUpdateWorldsStatus)
