import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { rejectRevisionProposalSchema } from '#shared/schemas/feedback'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 保存拒绝原因后的提案。 */
async function handleRejectProposal(event: H3Event) {
  return await executeController(event, async () => {
    const proposalId = resourceIdSchema.parse(getRouterParam(event, 'proposalId'))
    const input = rejectRevisionProposalSchema.parse(await readBody(event))
    return await event.context.applicationServices.feedback.rejectProposal(proposalId, input.reason)
  })
}

export default defineEventHandler(handleRejectProposal)
