import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { updateGrowthSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 修改世界成长并建立新的待确认修订。
 * @param event 当前 H3 请求，路径包含世界和成长 UUID，请求体包含新修订内容。
 * @returns 修改后的最新世界成长工作区响应。
 */
async function handleUpdateWorldGrowth(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const growthId = resourceIdSchema.parse(getRouterParam(event, 'growthId'))
    const input = updateGrowthSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.updateGrowth('world', worldId, growthId, input)
  })
}

export default defineEventHandler(handleUpdateWorldGrowth)
