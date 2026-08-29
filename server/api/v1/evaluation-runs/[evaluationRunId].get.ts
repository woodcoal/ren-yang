import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 评测运行和逐用例结果。 */
async function handleGetEvaluationRun(event: H3Event) {
  return await executeController(event, async () => {
    const evaluationRunId = resourceIdSchema.parse(getRouterParam(event, 'evaluationRunId'))
    return await event.context.applicationServices.feedback.getEvaluationRun(evaluationRunId)
  })
}

export default defineEventHandler(handleGetEvaluationRun)
