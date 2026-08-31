import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { createAiConnectionSchema } from '#shared/schemas/aiConfiguration'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前已认证请求。 @returns 创建后的脱敏 AI 接口连接。 */
async function handleCreateAiConnection(event: H3Event) {
  return await executeController(event, async () => {
    const input = createAiConnectionSchema.parse(await readBody(event))
    return await event.context.applicationServices.aiConfiguration.createConnection(input)
  })
}

export default defineEventHandler(handleCreateAiConnection)
