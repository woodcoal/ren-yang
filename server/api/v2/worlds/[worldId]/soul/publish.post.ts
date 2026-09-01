import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../../presentation/http/publicJson'

/**
 * 发布世界当前灵魂草稿。
 * @param event 已认证 API Key 且包含世界 UUID 的请求事件。
 * @returns 由草稿生成的新当前灵魂版本。
 * @remarks 要求 `world:write` 权限和幂等键，复用网页端版本冲突和 Token 预算规则。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'worldId')
  return await executePublicWriteController(event, 'world:write', {
    payload: { worldId: rawId }, targetType: 'world_soul', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => toPublicJson(await event.context.applicationServices.soul.publishDraft(
    'world', resourceIdSchema.parse(rawId),
  )))
})
