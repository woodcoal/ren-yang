import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/**
 * 查询人物列表。
 * @param event 当前 H3 请求事件。
 * @returns 统一人物列表响应。
 */
async function handleListPersonas(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.content.listPersonas())
}

export default defineEventHandler(handleListPersonas)
