import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, updatePersonaStatusSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 启用或停用指定人物。
 * @param event 已认证 API Key 且包含人物 UUID 与状态的请求事件。
 * @returns 状态更新后的人物详情。
 * @remarks 要求 `persona:write` 权限和幂等键，保留版本与关联数据。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'personaId')
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'persona:write', {
    payload: body, targetType: 'persona', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => toPublicJson(await event.context.applicationServices.content.updatePersonaStatus(
    resourceIdSchema.parse(rawId), updatePersonaStatusSchema.parse(body),
  )))
})
