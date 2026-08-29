import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, saveSoulDraftSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 创建或覆盖世界当前唯一灵魂草稿。
 * @param event 当前请求。
 * @returns 保存后的灵魂草稿。
 */
async function handleSaveWorldSoulDraft(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = saveSoulDraftSchema.parse(await readBody(event))
    return await event.context.applicationServices.soul.saveDraft('world', worldId, input)
  })
}

export default defineEventHandler(handleSaveWorldSoulDraft)
