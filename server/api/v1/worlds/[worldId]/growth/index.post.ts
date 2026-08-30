import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { createGrowthMaterialSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 添加手工素材后的世界成长工作区。 */
async function handleCreateWorldGrowth(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = createGrowthMaterialSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.createGrowthMaterial('world', worldId, input)
  })
}

export default defineEventHandler(handleCreateWorldGrowth)
