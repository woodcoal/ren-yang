import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/**
 * 清除当前管理员会话。
 * @param event 当前 H3 请求事件。
 * @returns 统一空响应。
 */
async function handleLogout(event: H3Event) {
  return await executeController(event, async () => {
    await event.context.applicationServices.authentication.logout()
    return null
  })
}

export default defineEventHandler(handleLogout)
