import type { H3Event } from 'h3'
import { getRouterParam, readBody, setResponseHeader } from 'h3'
import { personaCredentialSchema, resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 保存人物三项分别可选的账号信息，并禁止中间缓存响应。
 * @param event 当前 H3 请求事件。
 * @returns 不含密码的最新账号信息状态。
 */
async function handleSavePersonaCredential(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = personaCredentialSchema.parse(await readBody(event))
    setResponseHeader(event, 'Cache-Control', 'no-store')
    return await event.context.applicationServices.content.savePersonaCredential(personaId, input)
  })
}

export default defineEventHandler(handleSavePersonaCredential)
