import type { H3Event } from 'h3'
import { getRouterParam, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 永久删除人物聚合。
 * @param event 当前 H3 请求事件。
 * @returns 204 空响应。
 */
async function handleDeletePersona(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    await event.context.applicationServices.content.deletePersona(personaId)
    setResponseStatus(event, 204)
  })
}

export default defineEventHandler(handleDeletePersona)
