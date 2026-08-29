import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 由记忆显式创建的人物反馈资料。 */
async function handleConvertMemory(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const memoryId = resourceIdSchema.parse(getRouterParam(event, 'memoryId'))
    return await event.context.applicationServices.learning.convertMemoryToFeedbackSource(personaId, memoryId)
  })
}

export default defineEventHandler(handleConvertMemory)
