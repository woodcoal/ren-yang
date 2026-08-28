import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, updateWorldSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 修改世界名称和摘要。
 * @param event 当前 H3 请求事件。
 * @returns 更新后世界详情响应。
 */
async function handleUpdateWorld(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = updateWorldSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.updateWorld(worldId, input)
  })
}

export default defineEventHandler(handleUpdateWorld)
