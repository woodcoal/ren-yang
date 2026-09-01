import { getRouterParam } from 'h3'
import { apiKeyIdSchema } from '#shared/schemas/publicApi'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 立即吊销指定 API Key。
 * @param event 已通过管理员会话校验且包含 Key UUID 的请求事件。
 * @returns 吊销后的 API Key 管理视图。
 * @remarks 重复吊销保持幂等；吊销后下一次公共请求即失效。
 */
export default defineEventHandler(async event => await executeController(
  event,
  async () => await event.context.applicationServices.apiKeys.revoke(
    apiKeyIdSchema.parse(getRouterParam(event, 'apiKeyId')),
  ),
))
