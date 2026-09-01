import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { interestBatchInputItemSchema } from '#shared/schemas/generation'
import { executePublicWriteController } from '../../../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../../../presentation/http/publicJson'

/**
 * 仅重新执行兴趣批次中的一个失败条目。
 * @param event 已认证 API Key，路径中包含批次 UUID 和客户端条目标识。
 * @returns 已重新排队后的完整批次视图。
 * @remarks 要求 `generation:write` 权限和幂等键，不携带旧模型回答。
 */
export default defineEventHandler(async (event) => {
  const rawBatchId = getRouterParam(event, 'batchId')
  const rawItemId = getRouterParam(event, 'itemId')
  const batchId = resourceIdSchema.parse(rawBatchId)
  const itemId = interestBatchInputItemSchema.shape.itemId.parse(rawItemId)
  return await executePublicWriteController(event, 'generation:write', {
    payload: { batchId, itemId },
    targetType: 'interest_batch_item',
    successStatusCode: 202,
    targetId: () => batchId,
  }, async () => toPublicJson(await event.context.applicationServices.generation.retryInterestBatchItem(batchId, itemId)))
})
