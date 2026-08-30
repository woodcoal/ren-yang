import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { createLearningPromptDraftFromVersionSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../../presentation/http/controller'

/**
 * 基于指定历史版本创建可编辑的人物成长提示词草稿。
 * @param event 当前请求，路径包含人物 UUID，请求体包含历史版本 UUID。
 * @returns 创建后的人物成长提示词工作区。
 */
async function handleCreatePersonaGrowthPromptDraftFromVersion(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = createLearningPromptDraftFromVersionSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.createLearningPromptDraftFromVersion('persona_growth', personaId, input)
  })
}

export default defineEventHandler(handleCreatePersonaGrowthPromptDraftFromVersion)
