import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { generateWorldDraftSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 生成不落库的世界候选草稿，由列表页继续调用世界创建接口。
 * @param event 当前已认证请求。
 * @returns 结构化世界草稿。
 */
async function handleGenerateWorldDraft(event: H3Event) {
  return await executeController(event, async () => {
    const input = generateWorldDraftSchema.parse(await readBody(event))
    return await event.context.applicationServices.generation.generateWorldDraft(input)
  })
}

export default defineEventHandler(handleGenerateWorldDraft)
