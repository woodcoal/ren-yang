import { getRouterParam, setResponseStatus } from 'h3'
import { apiKeyIdSchema } from '#shared/schemas/publicApi'
import { executeController } from '../../../presentation/http/controller'

/**
 * 永久删除一个已吊销的 API Key 及其公共调用明细。
 * @param event 已通过管理员会话校验且路径包含 Key UUID 的请求事件。
 * @returns 删除成功时返回 204 空响应。
 * @remarks 有效或仅过期的 Key 会被应用服务拒绝，必须先显式吊销。
 */
export default defineEventHandler(async event => await executeController(event, async () => {
  const id = apiKeyIdSchema.parse(getRouterParam(event, 'apiKeyId'))
  await event.context.applicationServices.apiKeys.delete(id)
  setResponseStatus(event, 204)
}))
