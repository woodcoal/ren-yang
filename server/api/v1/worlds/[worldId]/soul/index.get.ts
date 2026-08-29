import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 查询世界当前灵魂、草稿和发布历史。
 * @param event 当前请求。
 * @returns 世界灵魂工作区。
 */
async function handleGetWorldSoul(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    return await event.context.applicationServices.soul.getSoul('world', worldId)
  })
}

export default defineEventHandler(handleGetWorldSoul)
