import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { createLearningPromptDraftFromVersionSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../../presentation/http/controller'

/**
 * 基于指定历史版本创建可编辑的世界成长提示词草稿。
 * @param event 当前请求，路径包含世界 UUID，请求体包含历史版本 UUID。
 * @returns 创建后的世界成长提示词工作区。
 */
async function handleCreateWorldGrowthPromptDraftFromVersion(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = createLearningPromptDraftFromVersionSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.createLearningPromptDraftFromVersion('world_growth', worldId, input)
  })
}

export default defineEventHandler(handleCreateWorldGrowthPromptDraftFromVersion)
