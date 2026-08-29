import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { createAnalysisBatchSchema } from '#shared/schemas/analysis'
import { executeController } from '../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 已排队的人物成长分析批次。 */
async function handleAnalyzePersonaGrowth(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = createAnalysisBatchSchema.parse(await readBody(event))
    return await event.context.applicationServices.analysis.createBatch('persona_growth', personaId, input)
  })
}

export default defineEventHandler(handleAnalyzePersonaGrowth)
