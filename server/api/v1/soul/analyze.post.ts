import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { analyzeSoulPromptInputSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 在人物或世界创建前独立整理灵魂提示词，不写入任何业务对象。
 * @param event 当前已认证请求。
 * @returns 模型整理并通过共享 Schema 校验的单文本灵魂快照。
 */
async function handleAnalyzeSoulPrompt(event: H3Event) {
  return await executeController(event, async () => {
    const input = analyzeSoulPromptInputSchema.parse(await readBody(event))
    return await event.context.applicationServices.soul.analyzePrompt(input.subjectType, input.promptText)
  })
}

export default defineEventHandler(handleAnalyzeSoulPrompt)
