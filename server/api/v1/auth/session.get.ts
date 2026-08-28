import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/**
 * 返回经过数据库凭据版本复核的当前会话。
 * @param event 当前 H3 请求事件。
 * @returns 统一登录状态响应。
 */
async function handleSession(event: H3Event) {
  return await executeController(event, async () => {
    return await event.context.applicationServices.authentication.getSession()
  })
}

export default defineEventHandler(handleSession)
