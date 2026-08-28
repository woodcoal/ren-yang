import type { H3Event } from 'h3'
import { readBody, setResponseStatus } from 'h3'
import { createWorldSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 创建世界设定和初始候选版本。
 * @param event 当前 H3 请求事件。
 * @returns 新世界详情响应。
 */
async function handleCreateWorld(event: H3Event) {
  return await executeController(event, async () => {
    const input = createWorldSchema.parse(await readBody(event))
    const created = await event.context.applicationServices.content.createWorld(input)
    setResponseStatus(event, 201)
    return created
  })
}

export default defineEventHandler(handleCreateWorld)
