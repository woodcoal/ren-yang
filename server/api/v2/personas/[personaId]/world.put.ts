import { getRouterParam, readBody } from 'h3'
import { publicPersonaIdentifierSchema, setPersonaWorldSchema } from '#shared/schemas/publicApi'
import { executePublicWriteController } from '../../../../presentation/http/publicController'
import { readPublicPersonaId, toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 建立或替换人物的唯一世界关系。
 * @param event 已认证 API Key，路径包含人物 UUID、用户名或邮箱，正文包含世界 UUID。
 * @returns 关系生效后的人物详情。
 * @remarks 要求 `persona:write` 权限和幂等键，目标世界必须存在。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'personaId')
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'persona:write', {
    payload: body, targetType: 'persona_world', successStatusCode: 200, targetId: readPublicPersonaId,
  }, async () => {
    const input = setPersonaWorldSchema.parse(body)
    const identifier = publicPersonaIdentifierSchema.parse(rawId)
    const personaId = await event.context.applicationServices.content.resolvePersonaIdentifier(identifier)
    return toPublicJson(await event.context.applicationServices.content.setPersonaWorld(personaId, input.worldId))
  })
})
