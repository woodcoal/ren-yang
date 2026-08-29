import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 指定人物全部审核状态的记忆。 */
async function handleListPersonaMemories(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    return await event.context.applicationServices.feedback.listPersonaMemories(personaId)
  })
}

export default defineEventHandler(handleListPersonaMemories)
