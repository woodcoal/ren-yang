import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { listAnalysisBatchesQuerySchema } from '#shared/schemas/analysis'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 过滤后的后台提炼批次记录。 */
async function handleListAnalysisBatches(event: H3Event) {
  return await executeController(event, async () => {
    return await event.context.applicationServices.analysis.listBatches(listAnalysisBatchesQuerySchema.parse(getQuery(event)))
  })
}

export default defineEventHandler(handleListAnalysisBatches)
