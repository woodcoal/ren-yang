import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/**
 * 查询当前 Account 的全局资料集合。
 * @param event 当前 H3 请求事件。
 * @returns 全局资料 UUID 集合。
 */
async function handleListGlobalSources(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.content.listGlobalSourceIds())
}

export default defineEventHandler(handleListGlobalSources)
