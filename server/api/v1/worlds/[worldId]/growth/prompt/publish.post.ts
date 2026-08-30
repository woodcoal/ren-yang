import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { publishLearningPromptDraftSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../../presentation/http/controller'

/**
 * 发布当前世界成长提示词草稿，使其进入之后创建的新任务。
 * @param event 当前请求，路径包含世界 UUID，请求体包含版本变更说明。
 * @returns 新发布的世界成长提示词版本。
 */
async function handlePublishWorldGrowthPrompt(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = publishLearningPromptDraftSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.publishLearningPromptDraft('world_growth', worldId, input)
  })
}

export default defineEventHandler(handlePublishWorldGrowthPrompt)
