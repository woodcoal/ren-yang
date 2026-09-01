import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, updateWorldSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 修改世界名称和管理摘要。
 * @param event 已认证 API Key 且包含世界 UUID 与请求体的事件。
 * @returns 修改后的世界详情。
 * @remarks 要求 `world:write` 权限和幂等键，不直接修改已发布灵魂。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'worldId')
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'world:write', {
    payload: body, targetType: 'world', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => toPublicJson(await event.context.applicationServices.content.updateWorld(
    resourceIdSchema.parse(rawId), updateWorldSchema.parse(body),
  )))
})
