import type { H3Event } from 'h3'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前已认证请求。 @returns 全部脱敏 AI 接口连接。 */
async function handleListAiConnections(event: H3Event) {
  return await executeController(event, async () => {
    return await event.context.applicationServices.aiConfiguration.listConnections()
  })
}

export default defineEventHandler(handleListAiConnections)
