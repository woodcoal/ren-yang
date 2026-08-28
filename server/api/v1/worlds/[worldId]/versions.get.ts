import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 查询世界不可变版本列表。
 * @param event 当前 H3 请求事件。
 * @returns 世界版本列表响应。
 */
async function handleListWorldVersions(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    return (await event.context.applicationServices.content.getWorld(worldId)).versions
  })
}

export default defineEventHandler(handleListWorldVersions)
