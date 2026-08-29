import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { createAnalysisBatchSchema } from '#shared/schemas/analysis'
import { executeController } from '../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 已排队的世界成长分析批次。 */
async function handleAnalyzeWorldGrowth(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = createAnalysisBatchSchema.parse(await readBody(event))
    return await event.context.applicationServices.analysis.createBatch('world_growth', worldId, input)
  })
}

export default defineEventHandler(handleAnalyzeWorldGrowth)
