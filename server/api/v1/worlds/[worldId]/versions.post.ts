import type { H3Event } from 'h3'
import { getRouterParam, readBody, setResponseStatus } from 'h3'
import { createWorldVersionSchema, resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 从明确基础版本创建世界候选版本。
 * @param event 当前 H3 请求事件。
 * @returns 新候选版本响应。
 */
async function handleCreateWorldVersion(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = createWorldVersionSchema.parse(await readBody(event))
    const created = await event.context.applicationServices.content.createWorldVersion(worldId, input)
    setResponseStatus(event, 201)
    return created
  })
}

export default defineEventHandler(handleCreateWorldVersion)
