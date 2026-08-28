import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/**
 * 查询资料列表。
 * @param event 当前 H3 请求事件。
 * @returns 资料摘要列表响应。
 */
async function handleListSources(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.content.listSources())
}

export default defineEventHandler(handleListSources)
