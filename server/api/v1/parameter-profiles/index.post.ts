import type { H3Event } from 'h3'
import { readBody, setResponseStatus } from 'h3'
import { createParameterProfileSchema } from '#shared/schemas/generation'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 新参数方案版本响应。 */
async function handleCreateParameterProfile(event: H3Event) {
  return await executeController(event, async () => {
    const created = await event.context.applicationServices.generation.createParameterProfile(createParameterProfileSchema.parse(await readBody(event)))
    setResponseStatus(event, 201)
    return created
  })
}

export default defineEventHandler(handleCreateParameterProfile)
