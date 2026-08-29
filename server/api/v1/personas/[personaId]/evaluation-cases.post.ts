import type { H3Event } from 'h3'
import { getRouterParam, readBody, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { createEvaluationCaseSchema } from '#shared/schemas/feedback'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 新建不可变评测用例。 */
async function handleCreateEvaluationCase(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = createEvaluationCaseSchema.parse(await readBody(event))
    const created = await event.context.applicationServices.feedback.createEvaluationCase(personaId, input)
    setResponseStatus(event, 201)
    return created
  })
}

export default defineEventHandler(handleCreateEvaluationCase)
