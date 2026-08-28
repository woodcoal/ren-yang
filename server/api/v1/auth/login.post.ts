import type { H3Event } from 'h3'
import { loginInputSchema } from '../../../../shared/schemas/authentication'
import { executeController } from '../../../presentation/http/controller'

/**
 * 验证唯一管理员并建立密封 Cookie 会话。
 * @param event 当前 H3 请求事件。
 * @returns 统一管理员身份响应或安全错误响应。
 */
async function handleLogin(event: H3Event) {
  return await executeController(event, async () => {
    const input = loginInputSchema.parse(await readBody(event))
    return await event.context.applicationServices.authentication.login(input)
  })
}

export default defineEventHandler(handleLogin)
