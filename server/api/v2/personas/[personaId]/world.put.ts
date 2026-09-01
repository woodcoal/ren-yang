import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { setPersonaWorldSchema } from '#shared/schemas/publicApi'
import { executePublicWriteController } from '../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 建立或替换人物的唯一世界关系。
 * @param event 已认证 API Key 且包含人物与世界 UUID 的请求事件。
 * @returns 关系生效后的人物详情。
 * @remarks 要求 `persona:write` 权限和幂等键，目标世界必须存在。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'personaId')
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'persona:write', {
    payload: body, targetType: 'persona_world', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => {
    const input = setPersonaWorldSchema.parse(body)
    return toPublicJson(await event.context.applicationServices.content.setPersonaWorld(resourceIdSchema.parse(rawId), input.worldId))
  })
})
