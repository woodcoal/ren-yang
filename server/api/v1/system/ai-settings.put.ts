import { readBody } from 'h3'
import { updateSystemAiSettingsSchema } from '#shared/schemas/systemAi'
import { executeController } from '../../../presentation/http/controller'

/**
 * 校验并完整替换全站默认文本与图片模型。
 * @param event 当前已认证的管理员请求事件，正文包含两个部署选择。
 * @returns 保存后的默认模型设置及更新时间。
 */
export default defineEventHandler(async event => await executeController(event, async () => {
  const input = updateSystemAiSettingsSchema.parse(await readBody(event))
  return await event.context.applicationServices.systemAiSettings.updateSettings(input)
}))
