import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../presentation/http/publicController'

/**
 * 在现有阻断和引用规则下删除人物。
 * @param event 已认证 API Key 且包含人物 UUID 的请求事件。
 * @returns 包含人物 UUID 和删除标记的结果。
 * @remarks 要求 `persona:write` 权限和幂等键；不绕过文件、运行历史或引用约束。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'personaId')
  return await executePublicWriteController(event, 'persona:write', {
    payload: { personaId: rawId }, targetType: 'persona', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => {
    const personaId = resourceIdSchema.parse(rawId)
    await event.context.applicationServices.content.deletePersona(personaId)
    return { id: personaId, deleted: true }
  })
})
