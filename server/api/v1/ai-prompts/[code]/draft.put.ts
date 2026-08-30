import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { aiPromptCodeSchema, saveAiPromptDraftSchema } from '#shared/schemas/aiPrompt'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 保存不立即影响新 AI 操作的提示词草稿。
 * @param event 当前管理员请求，路径包含提示词编码。
 * @returns 保存后的完整提示词工作区。
 */
async function handleSaveAiPromptDraft(event: H3Event) {
  return await executeController(event, async () => {
    const code = aiPromptCodeSchema.parse(getRouterParam(event, 'code'))
    const input = saveAiPromptDraftSchema.parse(await readBody(event))
    return await event.context.applicationServices.aiPrompts.saveDraft(code, input)
  })
}

export default defineEventHandler(handleSaveAiPromptDraft)
