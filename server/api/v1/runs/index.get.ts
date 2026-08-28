import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { listRunsQuerySchema } from '#shared/schemas/generation'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 过滤后的运行历史。 */
async function handleListRuns(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.generation.listRuns(listRunsQuerySchema.parse(getQuery(event))))
}

export default defineEventHandler(handleListRuns)
