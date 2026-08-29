import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 指定完整分析批次。 */
async function handleGetAnalysisBatch(event: H3Event) {
  return await executeController(event, async () => {
    const batchId = resourceIdSchema.parse(getRouterParam(event, 'batchId'))
    return await event.context.applicationServices.analysis.getBatch(batchId)
  })
}

export default defineEventHandler(handleGetAnalysisBatch)
