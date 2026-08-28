import type { H3Event } from 'h3'
import { setupAdministratorInputSchema } from '../../../../shared/schemas/authentication'
import { executeController } from '../../../presentation/http/controller'

/**
 * 从本机回环请求创建唯一管理员。
 * @param event 当前 H3 请求事件。
 * @returns 统一管理员身份响应或安全错误响应。
 */
async function handleAdministratorSetup(event: H3Event) {
  return await executeController(event, async () => {
    const input = setupAdministratorInputSchema.parse(await readBody(event))
    return await event.context.applicationServices.authentication.setupAdministrator(input)
  })
}

export default defineEventHandler(handleAdministratorSetup)
