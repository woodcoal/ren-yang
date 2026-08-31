import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 校验并加密保存外部上下文设置，省略 ADMIN Key 时保留现有密文。
 * @param event 当前已认证管理员请求。
 * @returns 保存后的脱敏设置。
 */
async function handleUpdateContextProviderSettings(event: H3Event) {
  return await executeController(event, async () => {
    // 应用服务统一执行共享 Schema 校验；控制器只负责传递已认证请求正文。
    const input = await readBody<Parameters<typeof event.context.applicationServices.contextSynchronization.updateSettings>[0]>(event)
    return await event.context.applicationServices.contextSynchronization.updateSettings(input)
  })
}

export default defineEventHandler(handleUpdateContextProviderSettings)
