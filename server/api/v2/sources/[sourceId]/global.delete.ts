import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 把指定资料移出全局使用范围。
 * @param event 已认证 API Key 且包含资料 UUID 的请求事件。
 * @returns 最终全局资料集合与本次差异。
 * @remarks 要求 `library:write` 权限和幂等键，只解除范围而不删除资料。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'sourceId')
  return await executePublicWriteController(event, 'library:write', {
    payload: { sourceId: rawId, isGlobal: false }, targetType: 'source_global', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => toPublicJson(await event.context.applicationServices.content.setSourceGlobal(
    resourceIdSchema.parse(rawId), false,
  )))
})
