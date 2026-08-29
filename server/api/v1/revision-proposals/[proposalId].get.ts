import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 修订提案差异、风险和门禁状态。 */
async function handleGetRevisionProposal(event: H3Event) {
  return await executeController(event, async () => {
    const proposalId = resourceIdSchema.parse(getRouterParam(event, 'proposalId'))
    return await event.context.applicationServices.feedback.getRevisionProposal(proposalId)
  })
}

export default defineEventHandler(handleGetRevisionProposal)
