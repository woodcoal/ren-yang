import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 删除人物尚未发布的灵魂草稿。
 * @param event 当前请求。
 * @returns 空响应。
 */
async function handleDeletePersonaSoulDraft(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    await event.context.applicationServices.soul.deleteDraft('persona', personaId)
    return null
  })
}

export default defineEventHandler(handleDeletePersonaSoulDraft)
