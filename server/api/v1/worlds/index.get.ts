import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/**
 * 查询世界列表。
 * @param event 当前 H3 请求事件。
 * @returns 世界摘要列表响应。
 */
async function handleListWorlds(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.content.listWorlds())
}

export default defineEventHandler(handleListWorlds)
