import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { generatePersonaDraftSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 生成不落库的人物候选草稿，由用户编辑确认后再调用人物创建接口。
 * @param event 当前已认证请求。
 * @returns 结构化人物草稿和可见截断提示。
 */
async function handleGeneratePersonaDraft(event: H3Event) {
  return await executeController(event, async () => {
    const input = generatePersonaDraftSchema.parse(await readBody(event))
    return await event.context.applicationServices.generation.generatePersonaDraft(input)
  })
}

export default defineEventHandler(handleGeneratePersonaDraft)
