import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { createPersonaFeedbackSourceSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 新建的人物反馈资料。 */
async function handleCreateFeedbackSource(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = createPersonaFeedbackSourceSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.createPersonaFeedbackSource(personaId, input)
  })
}

export default defineEventHandler(handleCreateFeedbackSource)
