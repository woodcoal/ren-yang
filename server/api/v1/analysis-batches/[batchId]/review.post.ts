import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { reviewIterationProposalsSchema } from '#shared/schemas/analysis'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 审核并应用后的完整分析批次。 */
async function handleReviewAnalysisBatch(event: H3Event) {
  return await executeController(event, async () => {
    const batchId = resourceIdSchema.parse(getRouterParam(event, 'batchId'))
    const input = reviewIterationProposalsSchema.parse(await readBody(event))
    return await event.context.applicationServices.analysis.review(batchId, input)
  })
}

export default defineEventHandler(handleReviewAnalysisBatch)
