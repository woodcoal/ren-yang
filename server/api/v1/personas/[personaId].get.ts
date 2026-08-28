import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 查询人物详情、版本和资料。
 * @param event 当前 H3 请求事件。
 * @returns 统一人物详情响应。
 */
async function handleGetPersona(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    return await event.context.applicationServices.content.getPersona(personaId)
  })
}

export default defineEventHandler(handleGetPersona)
