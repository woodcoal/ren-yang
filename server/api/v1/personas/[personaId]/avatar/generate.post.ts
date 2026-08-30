import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 根据人物当前名称和灵魂提示词生成头像。
 * @param event 当前 H3 请求事件。
 * @returns 更新头像后的人物摘要。
 */
async function handleGeneratePersonaAvatar(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    return await event.context.applicationServices.content.generatePersonaAvatar(personaId)
  })
}

export default defineEventHandler(handleGeneratePersonaAvatar)
