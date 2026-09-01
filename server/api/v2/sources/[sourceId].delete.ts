import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../presentation/http/publicController'

/**
 * 在现有阻断和文件边界下删除资料。
 * @param event 已认证 API Key 且包含资料 UUID 的请求事件。
 * @returns 包含资料 UUID 和删除标记的结果。
 * @remarks 要求 `library:write` 权限和幂等键；投影只按现有规则异步重建。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'sourceId')
  return await executePublicWriteController(event, 'library:write', {
    payload: { sourceId: rawId }, targetType: 'source', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => {
    const sourceId = resourceIdSchema.parse(rawId)
    await event.context.applicationServices.content.deleteSource(sourceId)
    return { id: sourceId, deleted: true }
  })
})
