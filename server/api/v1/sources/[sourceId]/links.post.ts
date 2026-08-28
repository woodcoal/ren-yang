import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { createSourceLinkSchema, resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 建立或更新资料关联。
 * @param event 当前 H3 请求事件。
 * @returns 更新后资料详情响应。
 */
async function handleLinkSource(event: H3Event) {
  return await executeController(event, async () => {
    const sourceId = resourceIdSchema.parse(getRouterParam(event, 'sourceId'))
    const input = createSourceLinkSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.linkSource(sourceId, input)
  })
}

export default defineEventHandler(handleLinkSource)
