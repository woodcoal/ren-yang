import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 删除世界尚未发布的灵魂草稿。
 * @param event 当前请求。
 * @returns 空响应。
 */
async function handleDeleteWorldSoulDraft(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    await event.context.applicationServices.soul.deleteDraft('world', worldId)
    return null
  })
}

export default defineEventHandler(handleDeleteWorldSoulDraft)
