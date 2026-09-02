import { getRouterParam } from 'h3'
import { publicPersonaIdentifierSchema } from '#shared/schemas/publicApi'
import { executePublicWriteController } from '../../../../presentation/http/publicController'
import { readPublicPersonaId, toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 解除人物当前的世界关系。
 * @param event 已认证 API Key 且包含人物 UUID、用户名或邮箱的请求事件。
 * @returns 关系解除后的人物详情。
 * @remarks 要求 `persona:write` 权限和幂等键，不删除人物或世界。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'personaId')
  return await executePublicWriteController(event, 'persona:write', {
    payload: { personaId: rawId }, targetType: 'persona_world', successStatusCode: 200, targetId: readPublicPersonaId,
  }, async () => {
    const identifier = publicPersonaIdentifierSchema.parse(rawId)
    const personaId = await event.context.applicationServices.content.resolvePersonaIdentifier(identifier)
    return toPublicJson(await event.context.applicationServices.content.setPersonaWorld(personaId, null))
  })
})
