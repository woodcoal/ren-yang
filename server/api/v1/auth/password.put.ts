import type { H3Event } from 'h3'
import { changeAdministratorPasswordInputSchema } from '../../../../shared/schemas/authentication'
import { executeController } from '../../../presentation/http/controller'

/**
 * 校验当前密码并修改唯一管理员密码。
 * @param event 已由认证中间件验证会话的 H3 请求事件。
 * @returns 统一管理员身份响应或安全错误响应。
 */
async function handleAdministratorPasswordChange(event: H3Event) {
  return await executeController(event, async () => {
    const input = changeAdministratorPasswordInputSchema.parse(await readBody(event))
    return await event.context.applicationServices.authentication.changePassword(input)
  })
}

export default defineEventHandler(handleAdministratorPasswordChange)
