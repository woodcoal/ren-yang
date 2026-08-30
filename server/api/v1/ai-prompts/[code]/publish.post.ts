import type { H3Event } from 'h3'
import { getRouterParam, readBody, setResponseStatus } from 'h3'
import { aiPromptCodeSchema, publishAiPromptDraftSchema } from '#shared/schemas/aiPrompt'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 把当前提示词草稿发布为新不可变版本。
 * @param event 当前管理员请求，路径包含提示词编码。
 * @returns 新发布的提示词版本。
 */
async function handlePublishAiPromptDraft(event: H3Event) {
  return await executeController(event, async () => {
    const code = aiPromptCodeSchema.parse(getRouterParam(event, 'code'))
    const input = publishAiPromptDraftSchema.parse(await readBody(event))
    const published = await event.context.applicationServices.aiPrompts.publishDraft(code, input)
    setResponseStatus(event, 201)
    return published
  })
}

export default defineEventHandler(handlePublishAiPromptDraft)
