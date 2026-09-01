import { executeController } from '../../../presentation/http/controller'

/**
 * 列出当前管理员可见的 API Key 管理信息。
 * @param event 已通过管理员会话校验的请求事件。
 * @returns 不包含摘要和明文的 API Key 列表。
 * @remarks 公共 API Key 不能调用本管理接口。
 */
export default defineEventHandler(async event => await executeController(
  event,
  async () => await event.context.applicationServices.apiKeys.list(),
))
