import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { publishLearningPromptDraftSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../../presentation/http/controller'

/**
 * 发布当前人物记忆提示词草稿，使其进入之后创建的新任务。
 * @param event 当前请求，路径包含人物 UUID，请求体包含版本变更说明。
 * @returns 新发布的人物记忆提示词版本。
 */
async function handlePublishPersonaMemoryPrompt(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = publishLearningPromptDraftSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.publishLearningPromptDraft('persona_memory', personaId, input)
  })
}

export default defineEventHandler(handlePublishPersonaMemoryPrompt)
