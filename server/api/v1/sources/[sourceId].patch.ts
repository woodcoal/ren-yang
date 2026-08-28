import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, updateSourceSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 修改资料元数据和正文并重建切片。
 * @param event 当前 H3 请求事件。
 * @returns 更新后资料详情响应。
 */
async function handleUpdateSource(event: H3Event) {
  return await executeController(event, async () => {
    const sourceId = resourceIdSchema.parse(getRouterParam(event, 'sourceId'))
    const input = updateSourceSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.updateSource(sourceId, input)
  })
}

export default defineEventHandler(handleUpdateSource)
