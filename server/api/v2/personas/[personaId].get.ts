import { getRouterParam } from 'h3'
import { publicPersonaIdentifierSchema } from '#shared/schemas/publicApi'
import { executePublicController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 查询单个人物的公共详情。
 * @param event 已认证 API Key 且包含人物 UUID、用户名或邮箱的请求事件。
 * @returns 不含账号凭据的人物详情、灵魂版本和资料关系。
 * @remarks 要求 `persona:read` 权限，响应会过滤内部敏感字段。
 */
export default defineEventHandler(async event => await executePublicController(event, 'persona:read', async () => {
  const identifier = publicPersonaIdentifierSchema.parse(getRouterParam(event, 'personaId'))
  const personaId = await event.context.applicationServices.content.resolvePersonaIdentifier(identifier)
  return toPublicJson(await event.context.applicationServices.content.getPersona(personaId))
}))
