import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/**
 * 返回登录管理员可见的系统健康摘要。
 * @param event 当前 H3 请求事件。
 * @returns 统一系统健康响应。
 */
async function handleSystemHealth(event: H3Event) {
  return await executeController(event, async () => {
    return await event.context.applicationServices.system.getHealth()
  })
}

export default defineEventHandler(handleSystemHealth)
