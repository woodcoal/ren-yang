import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { publicCreateSourceLinkSchema } from '#shared/schemas/publicApi'
import { executePublicWriteController } from '../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 建立资料与人物或世界的直接关系。
 * @param event 已认证 API Key 且包含资料 UUID 与关系输入的事件。
 * @returns 建立关系后的资料详情。
 * @remarks 要求 `library:write` 权限和幂等键，目标资源必须存在。
 */
export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, 'sourceId')
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'library:write', {
    payload: body, targetType: 'source_link', successStatusCode: 200, targetId: () => rawId ?? null,
  }, async () => {
    const input = publicCreateSourceLinkSchema.parse(body)
    const targetId = input.targetType === 'persona'
      ? await event.context.applicationServices.content.resolvePersonaIdentifier(input.targetId)
      : input.targetId
    return toPublicJson(await event.context.applicationServices.content.linkSource(
      resourceIdSchema.parse(rawId), { ...input, targetId },
    ))
  })
})
