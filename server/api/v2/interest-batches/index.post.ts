import { readBody } from 'h3'
import { createInterestBatchSchema } from '#shared/schemas/generation'
import { executePublicWriteController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 创建同一人物的一次批量兴趣判定。
 * @param event 已认证 API Key 且包含顺序文本列表的请求事件。
 * @returns 批次 UUID 与按输入顺序排列的独立运行 UUID。
 * @remarks 要求 `generation:write` 权限和幂等键。
 */
export default defineEventHandler(async (event) => {
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'generation:write', {
    payload: body,
    targetType: 'interest_batch',
    successStatusCode: 202,
    targetId: data => readBatchId(data),
  }, async () => toPublicJson(await event.context.applicationServices.generation.createInterestBatch(
    createInterestBatchSchema.parse(body),
  )))
})

/**
 * 从未知公共创建结果中安全读取幂等审计需要的批次标识。
 * @param value 控制器返回的未知结果。
 * @returns 结果内的批次 UUID；结构不匹配时返回 null。
 */
function readBatchId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const batchId = (value as Record<string, unknown>).batchId
  return typeof batchId === 'string' ? batchId : null
}
