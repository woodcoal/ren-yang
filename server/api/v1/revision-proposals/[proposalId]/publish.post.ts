import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { publishRevisionProposalSchema } from '#shared/schemas/feedback'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 明确人工确认后发布的提案。 */
async function handlePublishProposal(event: H3Event) {
  return await executeController(event, async () => {
    const proposalId = resourceIdSchema.parse(getRouterParam(event, 'proposalId'))
    publishRevisionProposalSchema.parse(await readBody(event))
    return await event.context.applicationServices.feedback.publishProposal(proposalId)
  })
}

export default defineEventHandler(handlePublishProposal)
