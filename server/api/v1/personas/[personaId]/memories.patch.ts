import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { updatePersonaMemoryStatusSchema } from '#shared/schemas/feedback'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 审核状态更新后的人物记忆。 */
async function handleUpdatePersonaMemory(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = updatePersonaMemoryStatusSchema.parse(await readBody(event))
    return await event.context.applicationServices.feedback.updatePersonaMemoryStatus(personaId, input)
  })
}

export default defineEventHandler(handleUpdatePersonaMemory)
