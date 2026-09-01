import { readBody, setResponseStatus } from 'h3'
import { createApiKeySchema } from '#shared/schemas/publicApi'
import { executeController } from '../../../presentation/http/controller'

/**
 * 根据管理员选择的权限和到期时间创建 API Key。
 * @param event 已通过管理员会话校验的请求事件。
 * @returns 仅本次响应包含明文的新 API Key。
 * @remarks 明文不进入数据库、日志或后续列表响应。
 */
export default defineEventHandler(async event => await executeController(event, async () => {
  const input = createApiKeySchema.parse(await readBody(event))
  const created = await event.context.applicationServices.apiKeys.create(input)
  setResponseStatus(event, 201)
  return created
}))
