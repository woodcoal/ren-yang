import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 参数方案列表响应。 */
async function handleListParameterProfiles(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.generation.listParameterProfiles())
}

export default defineEventHandler(handleListParameterProfiles)
