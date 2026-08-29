import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 校验预算并发布人物当前灵魂草稿。
 * @param event 当前请求。
 * @returns 新发布灵魂版本。
 */
async function handlePublishPersonaSoul(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    return await event.context.applicationServices.soul.publishDraft('persona', personaId)
  })
}

export default defineEventHandler(handlePublishPersonaSoul)
