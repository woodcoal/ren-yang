import type { H3Event } from 'h3'
import { getRouterParam, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { interestBatchInputItemSchema } from '#shared/schemas/generation'
import { executeController } from '../../../../../../presentation/http/controller'

/**
 * 通过管理员会话仅重试兴趣批次中的一个失败条目。
 * @param event 已认证且包含批次 UUID 与稳定条目标识的请求事件。
 * @returns 单项重新排队后的完整批次视图。
 */
async function handleRetryInterestBatchItem(event: H3Event) {
  const batchId = resourceIdSchema.parse(getRouterParam(event, 'batchId'))
  const itemId = interestBatchInputItemSchema.shape.itemId.parse(getRouterParam(event, 'itemId'))
  return await executeController(event, async () => {
    const batch = await event.context.applicationServices.generation.retryInterestBatchItem(batchId, itemId)
    setResponseStatus(event, 202)
    return batch
  })
}

export default defineEventHandler(handleRetryInterestBatchItem)
