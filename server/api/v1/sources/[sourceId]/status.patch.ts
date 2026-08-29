import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, updateSourceStatusSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 修改资料全局启用状态。
 * @param event 当前 H3 请求事件。
 * @returns 保留正文和关系的最新资料详情响应。
 */
async function handleUpdateSourceStatus(event: H3Event) {
  return await executeController(event, async () => {
    const sourceId = resourceIdSchema.parse(getRouterParam(event, 'sourceId'))
    const input = updateSourceStatusSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.updateSourceStatus(sourceId, input)
  })
}

export default defineEventHandler(handleUpdateSourceStatus)
