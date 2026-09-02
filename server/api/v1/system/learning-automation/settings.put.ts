import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { updateLearningAutomationSettingsSchema } from '#shared/schemas/learningAutomation'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 保存后台统一学习自动化周期并重算下次执行时间。
 * @param event 当前已认证管理员请求。
 * @returns 更新后的周期设置。
 */
async function handleUpdateLearningAutomationSettings(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.learningAutomation.updateSettings(
    updateLearningAutomationSettingsSchema.parse(await readBody(event)),
  ))
}

export default defineEventHandler(handleUpdateLearningAutomationSettings)
