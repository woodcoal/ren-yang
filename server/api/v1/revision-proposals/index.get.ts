import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { listRevisionProposalsQuerySchema } from '#shared/schemas/feedback'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 按人物和状态筛选的修订提案。 */
async function handleListRevisionProposals(event: H3Event) {
  return await executeController(event, async () => {
    const filter = listRevisionProposalsQuerySchema.parse(getQuery(event))
    return await event.context.applicationServices.feedback.listRevisionProposals(filter)
  })
}

export default defineEventHandler(handleListRevisionProposals)
