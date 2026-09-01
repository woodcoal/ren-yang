import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, updateSourceSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 修改资料名称、角色和规范化正文。
 * @param event 已认证 API Key 且包含资料 UUID 与请求体的事件。
 * @returns 重建切片并排队投影同步后的资料详情。
 * @remarks 要求 `library:write` 权限和幂等键，语义投影仍由异步同步链处理。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'sourceId')
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'library:write', {
    payload: body, targetType: 'source', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => toPublicJson(await event.context.applicationServices.content.updateSource(
    resourceIdSchema.parse(rawId), updateSourceSchema.parse(body),
  )))
})
