import type { H3Event } from 'h3'
import { readBody, setResponseStatus } from 'h3'
import { createGenerationRunSchema } from '#shared/schemas/generation'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 已创建文档规划运行标识。 */
async function handleCreateGenerationRun(event: H3Event) {
  return await executeController(event, async () => {
    const created = await event.context.applicationServices.generation.createGenerationRun(createGenerationRunSchema.parse(await readBody(event)))
    setResponseStatus(event, 202)
    return created
  })
}

export default defineEventHandler(handleCreateGenerationRun)
