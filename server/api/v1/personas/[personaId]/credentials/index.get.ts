import type { H3Event } from 'h3'
import { getRouterParam, setResponseHeader } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 在管理员主动请求时解密人物密码，并禁止中间缓存响应。
 * @param event 当前 H3 请求事件。
 * @returns 可选账号、可选邮箱和解密后的密码。
 */
async function handleRevealPersonaCredential(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    setResponseHeader(event, 'Cache-Control', 'no-store')
    return await event.context.applicationServices.content.revealPersonaCredential(personaId)
  })
}

export default defineEventHandler(handleRevealPersonaCredential)
