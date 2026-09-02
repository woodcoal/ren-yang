import { readBody } from 'h3'
import { publicCreateSynchronousGenerationRunSchema } from '#shared/schemas/publicApi'
import { executePublicWriteController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 创建持久图文运行并在调用方限定时间内等待最终产物。
 * @param event 已认证 API Key 且包含图文要求和可选等待时长的请求事件。
 * @returns 限时内终止时返回 200 与运行详情；超时返回 202 与当前运行及任务标识。
 * @remarks 成功或部分成功时直接附带请求格式的渲染结果，超时不会取消后台运行。
 */
export default defineEventHandler(async (event) => {
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'generation:write', {
    payload: body,
    targetType: 'generation_run',
    successStatusCode: 202,
    targetId: data => readCreatedRun(data)?.runId ?? null,
    resolveResponse: async (data) => {
      const created = readCreatedRun(data)
      if (!created) throw new Error('同步图文运行创建结果缺少运行或任务标识')
      const input = publicCreateSynchronousGenerationRunSchema.parse(body)
      const result = await event.context.applicationServices.generation.waitForGenerationRun(
        created.runId,
        created.taskId,
        input.waitTimeoutMs,
      )
      return { data: toPublicJson(result), statusCode: result.mode === 'completed' ? 200 : 202 }
    },
  }, async () => {
    const input = publicCreateSynchronousGenerationRunSchema.parse(body)
    const personaId = await event.context.applicationServices.content.resolvePersonaIdentifier(input.personaId)
    return toPublicJson(await event.context.applicationServices.generation.createGenerationRun({
      personaId,
      requirement: input.requirement,
      outputFormat: input.outputFormat,
      imageCount: input.imageCount,
    }))
  })
})

/**
 * 从未知公共创建结果中安全读取运行与首任务标识。
 * @param value 已持久化或幂等复用的公共创建结果。
 * @returns 运行和任务 UUID；任一字段缺失时返回 null。
 */
function readCreatedRun(value: unknown): { runId: string, taskId: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  return typeof record.runId === 'string' && typeof record.taskId === 'string'
    ? { runId: record.runId, taskId: record.taskId }
    : null
}
