import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/**
 * 查询是否需要首次创建管理员。
 * @param event 当前 H3 请求事件。
 * @returns 统一设置状态响应。
 */
async function handleSetupStatus(event: H3Event) {
  return await executeController(event, async () => {
    return await event.context.applicationServices.authentication.getSetupStatus()
  })
}

export default defineEventHandler(handleSetupStatus)
