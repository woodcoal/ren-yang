import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 接受取消后的运行详情。 */
async function handleCancelRun(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.generation.cancelRun(resourceIdSchema.parse(getRouterParam(event, 'runId'))))
}

export default defineEventHandler(handleCancelRun)
