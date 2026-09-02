import { getRouterParam } from 'h3'
import { publicPersonaIdentifierSchema } from '#shared/schemas/publicApi'
import { executePublicWriteController } from '../../../presentation/http/publicController'
import { readPublicPersonaId } from '../../../presentation/http/publicJson'

/**
 * 在现有阻断和引用规则下删除人物。
 * @param event 已认证 API Key 且包含人物 UUID、用户名或邮箱的请求事件。
 * @returns 删除成功时返回 204 空响应。
 * @remarks 要求 `persona:write` 权限和幂等键；不绕过文件、运行历史或引用约束。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'personaId')
  return await executePublicWriteController(event, 'persona:write', {
    payload: { personaId: rawId }, targetType: 'persona', successStatusCode: 204, targetId: readPublicPersonaId,
  }, async () => {
    const identifier = publicPersonaIdentifierSchema.parse(rawId)
    const personaId = await event.context.applicationServices.content.resolvePersonaIdentifier(identifier)
    await event.context.applicationServices.content.deletePersona(personaId)
    return { id: personaId, deleted: true }
  })
})
