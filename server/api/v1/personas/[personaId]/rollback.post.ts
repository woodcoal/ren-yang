import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, rollbackPersonaSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 回滚人物当前已发布版本指针。
 * @param event 当前 H3 请求事件。
 * @returns 回滚后人物详情响应。
 */
async function handleRollbackPersona(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = rollbackPersonaSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.rollbackPersona(personaId, input.versionId)
  })
}

export default defineEventHandler(handleRollbackPersona)
