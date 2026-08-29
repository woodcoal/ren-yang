import type { H3Event } from 'h3'
import { getRouterParam, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 新建评测运行与持久任务标识。 */
async function handleEvaluateProposal(event: H3Event) {
  return await executeController(event, async () => {
    const proposalId = resourceIdSchema.parse(getRouterParam(event, 'proposalId'))
    const created = await event.context.applicationServices.feedback.enqueueProposalEvaluation(proposalId)
    setResponseStatus(event, 202)
    return created
  })
}

export default defineEventHandler(handleEvaluateProposal)
