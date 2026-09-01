import { getRouterParam } from 'h3'
import { deleteSourceLinkSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../../presentation/http/publicJson'

/**
 * 解除资料的指定人物或世界关系。
 * @param event 已认证 API Key 且包含资料与关系标识的请求事件。
 * @returns 解除关系后的资料详情。
 * @remarks 要求 `library:write` 权限和幂等键，不删除任何资源。
 */
export default defineEventHandler(async (event) => {
  const sourceId = getRouterParam(event, 'sourceId')
  const linkId = getRouterParam(event, 'linkId')
  return await executePublicWriteController(event, 'library:write', {
    payload: { sourceId, linkId }, targetType: 'source_link', successStatusCode: 200, targetId: () => sourceId ?? null,
  }, async () => {
    const parameters = deleteSourceLinkSchema.parse({ sourceId, linkId })
    return toPublicJson(await event.context.applicationServices.content.unlinkSource(parameters.sourceId, parameters.linkId))
  })
})
