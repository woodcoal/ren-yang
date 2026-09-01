import type { H3Event } from 'h3'
import { getQuery, getRouterParam, setResponseHeader } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { imageAssetVariantSchema } from '#shared/schemas/generation'
import { executeBinaryController } from '../../../../presentation/http/controller'

/**
 * 读取当前人物头像。
 * @param event 当前 H3 请求事件。
 * @returns 禁止缓存的头像图片字节。
 */
async function handleGetPersonaAvatar(event: H3Event) {
  setResponseHeader(event, 'cache-control', 'no-store')
  return await executeBinaryController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const variant = imageAssetVariantSchema.parse(getQuery(event).variant)
    return await event.context.applicationServices.content.getPersonaAvatar(personaId, variant)
  })
}

export default defineEventHandler(handleGetPersonaAvatar)
