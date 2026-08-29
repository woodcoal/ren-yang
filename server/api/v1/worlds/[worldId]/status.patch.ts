import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, updateWorldStatusSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 修改单个世界启用状态。
 * @param event 当前 H3 请求事件，路径包含世界 UUID，请求体包含新状态。
 * @returns 保留版本、资料、人物关系和历史记录的最新世界详情响应。
 */
async function handleUpdateWorldStatus(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = updateWorldStatusSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.updateWorldStatus(worldId, input)
  })
}

export default defineEventHandler(handleUpdateWorldStatus)
