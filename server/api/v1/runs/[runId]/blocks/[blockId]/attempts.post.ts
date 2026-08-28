import type { H3Event } from 'h3'
import { getRouterParam, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 新单块重试任务。 */
async function handleRetryBlock(event: H3Event) {
  return await executeController(event, async () => {
    const runId = resourceIdSchema.parse(getRouterParam(event, 'runId'))
    const blockId = resourceIdSchema.parse(getRouterParam(event, 'blockId'))
    const result = await event.context.applicationServices.generation.retryBlock(runId, blockId)
    setResponseStatus(event, 202)
    return result
  })
}

export default defineEventHandler(handleRetryBlock)
