import { readBody } from 'h3'
import { publicCreateSynchronousInterestBatchSchema } from '#shared/schemas/publicApi'
import { executePublicWriteController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 创建持久兴趣批次并在调用方限定时间内等待完整结果。
 * @param event 已认证 API Key 且包含顺序文本列表和可选等待时长的请求事件。
 * @returns 限时内完成时返回 200 与完整批次；超时返回 202 与当前批次状态。
 * @remarks 等待超时不会取消后台任务，调用方继续使用原批次查询接口。
 */
export default defineEventHandler(async (event) => {
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'generation:write', {
    payload: body,
    targetType: 'interest_batch',
    successStatusCode: 202,
    targetId: data => readBatchId(data),
    resolveResponse: async (data) => {
      const batchId = readBatchId(data)
      if (!batchId) throw new Error('同步兴趣批次创建结果缺少批次标识')
      const input = publicCreateSynchronousInterestBatchSchema.parse(body)
      const result = await event.context.applicationServices.generation.waitForInterestBatch(batchId, input.waitTimeoutMs)
      return { data: toPublicJson(result), statusCode: result.mode === 'completed' ? 200 : 202 }
    },
  }, async () => {
    const input = publicCreateSynchronousInterestBatchSchema.parse(body)
    const personaId = await event.context.applicationServices.content.resolvePersonaIdentifier(input.personaId)
    return toPublicJson(await event.context.applicationServices.generation.createInterestBatch({
      personaId,
      additionalPrompt: input.additionalPrompt,
      items: input.items,
    }))
  })
})

/**
 * 从未知公共创建结果中安全读取批次标识。
 * @param value 已持久化或幂等复用的公共创建结果。
 * @returns 结果内的批次 UUID；结构不匹配时返回 null。
 */
function readBatchId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const batchId = (value as Record<string, unknown>).batchId
  return typeof batchId === 'string' ? batchId : null
}
