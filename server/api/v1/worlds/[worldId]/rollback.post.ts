import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, rollbackWorldSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 回滚世界当前已发布版本指针。
 * @param event 当前 H3 请求事件。
 * @returns 回滚后世界详情响应。
 */
async function handleRollbackWorld(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = rollbackWorldSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.rollbackWorld(worldId, input.versionId)
  })
}

export default defineEventHandler(handleRollbackWorld)
