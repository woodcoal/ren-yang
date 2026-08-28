import type { H3Event } from 'h3'
import { readBody, setResponseStatus } from 'h3'
import { createFormatTemplateSchema } from '#shared/schemas/generation'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 新格式模板版本响应。 */
async function handleCreateFormatTemplate(event: H3Event) {
  return await executeController(event, async () => {
    const created = await event.context.applicationServices.generation.createFormatTemplate(createFormatTemplateSchema.parse(await readBody(event)))
    setResponseStatus(event, 201)
    return created
  })
}

export default defineEventHandler(handleCreateFormatTemplate)
