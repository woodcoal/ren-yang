import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../presentation/http/publicController'

/**
 * 在现有阻断和引用规则下删除世界。
 * @param event 已认证 API Key 且包含世界 UUID 的请求事件。
 * @returns 包含世界 UUID 和删除标记的结果。
 * @remarks 要求 `world:write` 权限和幂等键；关联人物等阻断继续生效。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'worldId')
  return await executePublicWriteController(event, 'world:write', {
    payload: { worldId: rawId }, targetType: 'world', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => {
    const worldId = resourceIdSchema.parse(rawId)
    await event.context.applicationServices.content.deleteWorld(worldId)
    return { id: worldId, deleted: true }
  })
})
