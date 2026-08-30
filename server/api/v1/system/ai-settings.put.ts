import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { updateSystemAiSettingsSchema } from '#shared/schemas/systemAi'
import { executeController } from '../../../presentation/http/controller'

/**
 * 校验并完整替换系统内部四类 AI 操作参数。
 * @param event 当前已认证的 H3 请求事件，正文必须包含四类完整参数。
 * @returns 保存后的完整系统 AI 设置及更新时间。
 */
async function handleUpdateSystemAiSettings(event: H3Event) {
  return await executeController(event, async () => {
    const input = updateSystemAiSettingsSchema.parse(await readBody(event))
    return await event.context.applicationServices.systemAiSettings.updateSettings(input)
  })
}

export default defineEventHandler(handleUpdateSystemAiSettings)
