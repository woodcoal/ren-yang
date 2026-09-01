import type { H3Event } from 'h3'
import { readBody, setResponseStatus } from 'h3'
import { createInterestBatchSchema } from '#shared/schemas/generation'
import { executeController } from '../../../presentation/http/controller'

/**
 * 通过管理员会话创建同一人物的一次批量兴趣判定。
 * @param event 已认证且包含人物、顺序文本和可选附加提示词的请求。
 * @returns 批次 UUID 与严格保持输入顺序的独立运行 UUID。
 */
async function handleCreateInterestBatch(event: H3Event) {
  return await executeController(event, async () => {
    const created = await event.context.applicationServices.generation.createInterestBatch(
      createInterestBatchSchema.parse(await readBody(event)),
    )
    setResponseStatus(event, 202)
    return created
  })
}

export default defineEventHandler(handleCreateInterestBatch)
