import type { H3Event } from 'h3'
import { getRouterParam, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 规格确认并入队后的运行详情。 */
async function handleConfirmDocumentSpec(event: H3Event) {
  return await executeController(event, async () => {
    const details = await event.context.applicationServices.generation.confirmDocumentSpec(resourceIdSchema.parse(getRouterParam(event, 'runId')))
    setResponseStatus(event, 202)
    return details
  })
}

export default defineEventHandler(handleConfirmDocumentSpec)
