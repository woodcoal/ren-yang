import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 世界资料与成长工作区。 */
async function handleGetWorldGrowth(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    return await event.context.applicationServices.learning.getWorldGrowthWorkspace(worldId)
  })
}

export default defineEventHandler(handleGetWorldGrowth)
