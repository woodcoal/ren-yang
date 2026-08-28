import type { H3Event } from 'h3'
import { getRouterParam, readBody, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { updateDocumentSpecSchema } from '#shared/schemas/generation'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 新的不可变规格修订。 */
async function handleReviseDocumentSpec(event: H3Event) {
  return await executeController(event, async () => {
    const revised = await event.context.applicationServices.generation.reviseDocumentSpec(
      resourceIdSchema.parse(getRouterParam(event, 'runId')),
      updateDocumentSpecSchema.parse(await readBody(event)),
    )
    setResponseStatus(event, 201)
    return revised
  })
}

export default defineEventHandler(handleReviseDocumentSpec)
