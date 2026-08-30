import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../../presentation/http/controller'

/**
 * 删除尚未发布的世界成长提示词草稿。
 * @param event 当前请求，路径包含世界 UUID。
 * @returns 删除成功后的空响应。
 */
async function handleDeleteWorldGrowthPromptDraft(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    await event.context.applicationServices.learning.deleteLearningPromptDraft('world_growth', worldId)
    return null
  })
}

export default defineEventHandler(handleDeleteWorldGrowthPromptDraft)
