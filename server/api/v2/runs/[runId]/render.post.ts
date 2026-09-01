import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { renderArtifactSchema } from '#shared/schemas/generation'
import { executePublicWriteController } from '../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 即时渲染运行的文本或 HTML 结果。
 * @param event 已认证 API Key 且包含运行 UUID 与格式请求的事件。
 * @returns 文档文本和独立图片资产数据。
 * @remarks 要求 `generation:read` 权限和幂等键，本操作不修改运行结果。
 */
export default defineEventHandler(async (event) => {
  const rawRunId = getRouterParam(event, 'runId')
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'generation:read', {
    payload: body, targetType: 'generation_run_render', targetId: () => rawRunId ?? null, successStatusCode: 200,
  }, async () => {
    const runId = resourceIdSchema.parse(rawRunId)
    const input = renderArtifactSchema.parse(body)
    return toPublicJson(await event.context.applicationServices.generation.renderRun(runId, input.formats))
  })
})
