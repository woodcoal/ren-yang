import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { createSoulDraftFromVersionSchema, resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 从世界历史灵魂版本建立新的当前草稿。
 * @param event 当前请求。
 * @returns 新草稿。
 */
async function handleCreateWorldSoulDraftFromVersion(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = createSoulDraftFromVersionSchema.parse(await readBody(event))
    return await event.context.applicationServices.soul.createDraftFromVersion('world', worldId, input)
  })
}

export default defineEventHandler(handleCreateWorldSoulDraftFromVersion)
