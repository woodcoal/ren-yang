import { executeController } from '../../../presentation/http/controller'

/**
 * 返回全站默认文本与图片模型设置。
 * @param event 当前已认证的管理员请求事件。
 * @returns 默认模型选择及最近保存时间。
 */
export default defineEventHandler(async event => await executeController(
  event,
  async () => await event.context.applicationServices.systemAiSettings.getSettings(),
))
