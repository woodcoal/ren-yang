import type { H3Event } from 'h3'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 读取后台统一学习自动化周期设置。
 * @param event 当前已认证管理员请求。
 * @returns 当前周期和上、下次执行时间。
 */
async function handleGetLearningAutomationSettings(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.learningAutomation.getSettings())
}

export default defineEventHandler(handleGetLearningAutomationSettings)
