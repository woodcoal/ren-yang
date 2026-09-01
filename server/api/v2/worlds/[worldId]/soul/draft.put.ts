import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, saveSoulDraftSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../../presentation/http/publicJson'

/**
 * 创建或覆盖世界当前唯一灵魂草稿。
 * @param event 已认证 API Key 且包含世界 UUID 与草稿的请求事件。
 * @returns 保存后的世界灵魂草稿。
 * @remarks 要求 `world:write` 权限和幂等键；草稿不自动影响运行时。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'worldId')
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'world:write', {
    payload: body, targetType: 'world_soul_draft', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => toPublicJson(await event.context.applicationServices.soul.saveDraft(
    'world', resourceIdSchema.parse(rawId), saveSoulDraftSchema.parse(body),
  )))
})
