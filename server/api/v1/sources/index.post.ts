import type { H3Event } from 'h3'
import { readBody, setResponseStatus } from 'h3'
import { createSourceSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 创建粘贴文本资料并建立检索切片。
 * @param event 当前 H3 请求事件。
 * @returns 新资料详情响应。
 */
async function handleCreateSource(event: H3Event) {
  return await executeController(event, async () => {
    const input = createSourceSchema.parse(await readBody(event))
    const created = await event.context.applicationServices.content.createPastedSource(input)
    setResponseStatus(event, 201)
    return created
  })
}

export default defineEventHandler(handleCreateSource)
