import type { H3Event } from 'h3'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 返回不包含 ADMIN Key 明文或密文的外部上下文后台设置。
 * @param event 当前已认证管理员请求。
 * @returns 当前外部上下文设置。
 */
async function handleGetContextProviderSettings(event: H3Event) {
  return await executeController(event, async () => {
    return await event.context.applicationServices.contextSynchronization.getSettings()
  })
}

export default defineEventHandler(handleGetContextProviderSettings)
