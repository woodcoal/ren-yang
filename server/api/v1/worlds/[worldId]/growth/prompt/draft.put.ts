import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { saveLearningPromptDraftSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../../presentation/http/controller'

/**
 * 保存不会立即生效的世界成长提示词草稿。
 * @param event 当前请求，路径包含世界 UUID，请求体包含完整提示词与基线版本。
 * @returns 保存后的世界成长提示词工作区。
 */
async function handleSaveWorldGrowthPromptDraft(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = saveLearningPromptDraftSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.saveLearningPromptDraft('world_growth', worldId, input)
  })
}

export default defineEventHandler(handleSaveWorldGrowthPromptDraft)
