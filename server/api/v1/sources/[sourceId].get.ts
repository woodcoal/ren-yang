import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 查询资料正文、切片和关联。
 * @param event 当前 H3 请求事件。
 * @returns 资料详情响应。
 */
async function handleGetSource(event: H3Event) {
  return await executeController(event, async () => {
    const sourceId = resourceIdSchema.parse(getRouterParam(event, 'sourceId'))
    return await event.context.applicationServices.content.getSource(sourceId)
  })
}

export default defineEventHandler(handleGetSource)
