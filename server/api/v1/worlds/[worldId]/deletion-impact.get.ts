import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 分析世界永久删除影响。
 * @param event 当前 H3 请求事件。
 * @returns 删除影响响应。
 */
async function handleWorldDeletionImpact(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    return await event.context.applicationServices.content.getWorldDeletionImpact(worldId)
  })
}

export default defineEventHandler(handleWorldDeletionImpact)
