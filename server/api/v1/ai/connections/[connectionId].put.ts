import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { z } from 'zod'
import { updateAiConnectionSchema } from '#shared/schemas/aiConfiguration'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前已认证请求。 @returns 更新后的脱敏 AI 接口连接。 */
async function handleUpdateAiConnection(event: H3Event) {
  return await executeController(event, async () => {
    const connectionId = z.string().uuid('接口连接标识无效').parse(getRouterParam(event, 'connectionId'))
    const input = updateAiConnectionSchema.parse(await readBody(event))
    return await event.context.applicationServices.aiConfiguration.updateConnection(connectionId, input)
  })
}

export default defineEventHandler(handleUpdateAiConnection)
