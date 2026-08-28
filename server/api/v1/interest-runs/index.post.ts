import type { H3Event } from 'h3'
import { readBody, setResponseStatus } from 'h3'
import { createInterestRunSchema } from '#shared/schemas/generation'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 已入队兴趣运行标识。 */
async function handleCreateInterestRun(event: H3Event) {
  return await executeController(event, async () => {
    const created = await event.context.applicationServices.generation.createInterestRun(createInterestRunSchema.parse(await readBody(event)))
    setResponseStatus(event, 202)
    return created
  })
}

export default defineEventHandler(handleCreateInterestRun)
