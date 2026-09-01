import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, updateSourceStatusSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 启用或停用指定资料。
 * @param event 已认证 API Key 且包含资料 UUID 与状态的请求事件。
 * @returns 状态更新后的资料详情。
 * @remarks 要求 `library:write` 权限和幂等键，同步规则与网页端一致。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'sourceId')
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'library:write', {
    payload: body, targetType: 'source', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => toPublicJson(await event.context.applicationServices.content.updateSourceStatus(
    resourceIdSchema.parse(rawId), updateSourceStatusSchema.parse(body),
  )))
})
