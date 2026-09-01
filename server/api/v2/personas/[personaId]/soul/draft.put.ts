import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, saveSoulDraftSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../../presentation/http/publicJson'

/**
 * 创建或覆盖人物当前唯一灵魂草稿。
 * @param event 已认证 API Key 且包含人物 UUID 与草稿的请求事件。
 * @returns 保存后的人物灵魂草稿。
 * @remarks 要求 `persona:write` 权限和幂等键；草稿不自动影响运行时。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'personaId')
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'persona:write', {
    payload: body, targetType: 'persona_soul_draft', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => toPublicJson(await event.context.applicationServices.soul.saveDraft(
    'persona', resourceIdSchema.parse(rawId), saveSoulDraftSchema.parse(body),
  )))
})
