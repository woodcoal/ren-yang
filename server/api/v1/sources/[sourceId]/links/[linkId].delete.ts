import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { deleteSourceLinkSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 解除一项资料关联。
 * @param event 当前 H3 请求事件。
 * @returns 更新后资料详情响应。
 */
async function handleUnlinkSource(event: H3Event) {
  return await executeController(event, async () => {
    const parameters = deleteSourceLinkSchema.parse({
      sourceId: getRouterParam(event, 'sourceId'),
      linkId: getRouterParam(event, 'linkId'),
    })
    return await event.context.applicationServices.content.unlinkSource(parameters.sourceId, parameters.linkId)
  })
}

export default defineEventHandler(handleUnlinkSource)
