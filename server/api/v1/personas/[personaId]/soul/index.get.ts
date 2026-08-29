import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 查询人物当前灵魂、草稿和发布历史。
 * @param event 当前请求。
 * @returns 人物灵魂工作区。
 */
async function handleGetPersonaSoul(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    return await event.context.applicationServices.soul.getSoul('persona', personaId)
  })
}

export default defineEventHandler(handleGetPersonaSoul)
