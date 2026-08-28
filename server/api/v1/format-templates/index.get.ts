import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 格式模板列表响应。 */
async function handleListFormatTemplates(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.generation.listFormatTemplates())
}

export default defineEventHandler(handleListFormatTemplates)
