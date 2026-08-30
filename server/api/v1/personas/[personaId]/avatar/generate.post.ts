import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { generatePersonaAvatarSchema, resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 根据人物当前名称、灵魂提示词和可选视觉要求生成头像。
 * @param event 当前 H3 请求事件，请求体可包含用户补充的视觉提示词。
 * @returns 更新头像后的人物摘要。
 */
async function handleGeneratePersonaAvatar(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = generatePersonaAvatarSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.generatePersonaAvatar(personaId, input)
  })
}

export default defineEventHandler(handleGeneratePersonaAvatar)
