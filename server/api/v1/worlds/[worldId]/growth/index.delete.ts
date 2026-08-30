import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { deleteGrowthSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 批量永久删除世界成长素材快照。
 * @param event 当前 H3 请求，路径包含世界 UUID，请求体包含素材 UUID 集合。
 * @returns 删除后的最新世界成长工作区响应。
 */
async function handleDeleteWorldGrowth(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = deleteGrowthSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.deleteGrowthMaterials('world', worldId, input)
  })
}

export default defineEventHandler(handleDeleteWorldGrowth)
