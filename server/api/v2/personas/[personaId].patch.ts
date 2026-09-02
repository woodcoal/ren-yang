import { getRouterParam, readBody } from 'h3'
import { updatePersonaSchema } from '#shared/schemas/content'
import { publicPersonaIdentifierSchema } from '#shared/schemas/publicApi'
import { executePublicWriteController } from '../../../presentation/http/publicController'
import { readPublicPersonaId, toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 修改人物名称和唯一世界关系。
 * @param event 已认证 API Key 且包含人物 UUID、用户名或邮箱与请求体的事件。
 * @returns 修改后的人物详情。
 * @remarks 要求 `persona:write` 权限和幂等键，世界关系继续遵守现有校验。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'personaId')
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'persona:write', {
    payload: body, targetType: 'persona', successStatusCode: 200, targetId: readPublicPersonaId,
  }, async () => {
    const identifier = publicPersonaIdentifierSchema.parse(rawId)
    const personaId = await event.context.applicationServices.content.resolvePersonaIdentifier(identifier)
    return toPublicJson(await event.context.applicationServices.content.updatePersona(personaId, updatePersonaSchema.parse(body)))
  })
})
