import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 通过管理员会话查询兴趣批次及全部顺序结果。
 * @param event 已认证且包含兴趣批次 UUID 的请求事件。
 * @returns 批次状态、附加提示词与逐项判断结果。
 */
async function handleGetInterestBatch(event: H3Event) {
  const batchId = resourceIdSchema.parse(getRouterParam(event, 'batchId'))
  return await executeController(event, async () => await event.context.applicationServices.generation.getInterestBatch(batchId))
}

export default defineEventHandler(handleGetInterestBatch)
