import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { aiPromptCodeSchema } from '#shared/schemas/aiPrompt'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 删除尚未发布的提示词草稿。
 * @param event 当前管理员请求，路径包含提示词编码。
 * @returns 删除后的完整提示词工作区。
 */
async function handleDeleteAiPromptDraft(event: H3Event) {
  return await executeController(event, async () => {
    const code = aiPromptCodeSchema.parse(getRouterParam(event, 'code'))
    return await event.context.applicationServices.aiPrompts.deleteDraft(code)
  })
}

export default defineEventHandler(handleDeleteAiPromptDraft)
