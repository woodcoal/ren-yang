import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../../presentation/http/controller'

/**
 * 删除尚未发布的人物记忆提示词草稿。
 * @param event 当前请求，路径包含人物 UUID。
 * @returns 删除成功后的空响应。
 */
async function handleDeletePersonaMemoryPromptDraft(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    await event.context.applicationServices.learning.deleteLearningPromptDraft('persona_memory', personaId)
    return null
  })
}

export default defineEventHandler(handleDeletePersonaMemoryPromptDraft)
