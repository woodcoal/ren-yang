import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/**
 * 返回系统内部四类 AI 操作的当前参数。
 * @param event 当前已认证的 H3 请求事件。
 * @returns 完整系统 AI 设置及最近保存时间。
 */
async function handleGetSystemAiSettings(event: H3Event) {
  return await executeController(event, async () => {
    return await event.context.applicationServices.systemAiSettings.getSettings()
  })
}

export default defineEventHandler(handleGetSystemAiSettings)
