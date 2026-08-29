import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 人物反馈资料与成长工作区。 */
async function handleListFeedbackSources(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    return await event.context.applicationServices.learning.getPersonaGrowthWorkspace(personaId)
  })
}

export default defineEventHandler(handleListFeedbackSources)
