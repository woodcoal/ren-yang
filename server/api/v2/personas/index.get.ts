import { getQuery } from 'h3'
import { listSubjectsPageSchema } from '#shared/schemas/content'
import { executePublicController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 按公共契约统一查询人物列表。
 * @param event 已认证 API Key 且包含查询参数的请求事件。
 * @returns 筛选、排序和分页后的人物列表。
 * @remarks 要求 `persona:read` 权限并复用人物应用服务。
 */
export default defineEventHandler(async event => await executePublicController(event, 'persona:read', async () => {
  const input = listSubjectsPageSchema.parse(getQuery(event))
  return toPublicJson(await event.context.applicationServices.content.listPersonasPage(input))
}))
