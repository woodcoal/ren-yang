import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, updateWorldStatusSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 启用或停用指定世界。
 * @param event 已认证 API Key 且包含世界 UUID 与状态的请求事件。
 * @returns 状态更新后的世界详情。
 * @remarks 要求 `world:write` 权限和幂等键，保留版本与关联数据。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'worldId')
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'world:write', {
    payload: body, targetType: 'world', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => toPublicJson(await event.context.applicationServices.content.updateWorldStatus(
    resourceIdSchema.parse(rawId), updateWorldStatusSchema.parse(body),
  )))
})
