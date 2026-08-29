import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { batchLearningStatusSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 批量审核后的人物记忆工作区。 */
async function handleUpdateMemoryStatus(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = batchLearningStatusSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.updateMemoryStates(personaId, input)
  })
}

export default defineEventHandler(handleUpdateMemoryStatus)
