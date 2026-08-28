import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 完整运行详情。 */
async function handleGetRun(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.generation.getRun(resourceIdSchema.parse(getRouterParam(event, 'runId'))))
}

export default defineEventHandler(handleGetRun)
