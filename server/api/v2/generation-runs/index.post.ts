import { readBody } from 'h3'
import { publicCreateGenerationRunSchema } from '#shared/schemas/publicApi'
import { executePublicWriteController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 创建一次直接图文生成运行。
 * @param event 已认证 API Key 且包含创作输入的请求事件。
 * @returns 已入队运行和任务标识。
 * @remarks 要求 `generation:write` 权限和幂等键，复用网页端生成应用服务。
 */
export default defineEventHandler(async (event) => {
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'generation:write', {
    payload: body,
    targetType: 'generation_run',
    successStatusCode: 202,
    targetId: data => readRunId(data),
  }, async () => {
    const input = publicCreateGenerationRunSchema.parse(body)
    const personaId = await event.context.applicationServices.content.resolvePersonaIdentifier(input.personaId)
    return toPublicJson(await event.context.applicationServices.generation.createGenerationRun({ ...input, personaId }))
  })
})

/** @param value 公共创建结果。 @returns 运行 UUID 或 null。 */
function readRunId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const runId = (value as Record<string, unknown>).runId
  return typeof runId === 'string' ? runId : null
}
