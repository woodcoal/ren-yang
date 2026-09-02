import type { H3Event } from 'h3'
import { readBody, setResponseStatus } from 'h3'
import { createPersonaSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 按输入原文直接创建人物和初始当前灵魂版本。
 * @param event 当前 H3 请求事件。
 * @returns 统一人物详情响应。
 * @remarks 该接口不调用 AI；AI 蒸馏使用独立的人物蒸馏运行接口。
 */
async function handleCreatePersona(event: H3Event) {
  return await executeController(event, async () => {
    const input = createPersonaSchema.parse(await readBody(event))
    const created = await event.context.applicationServices.content.createPersona(input)
    setResponseStatus(event, 201)
    return created
  })
}

export default defineEventHandler(handleCreatePersona)
