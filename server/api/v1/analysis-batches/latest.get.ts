import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { latestAnalysisBatchQuerySchema } from '#shared/schemas/analysis'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 指定对象最新分析批次或 null。 */
async function handleGetLatestAnalysisBatch(event: H3Event) {
  return await executeController(event, async () => {
    const query = latestAnalysisBatchQuerySchema.parse(getQuery(event))
    return await event.context.applicationServices.analysis.getLatestBatch(query.analysisType, query.subjectId)
  })
}

export default defineEventHandler(handleGetLatestAnalysisBatch)
