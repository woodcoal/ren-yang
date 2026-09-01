import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 请求协作式取消活动运行。
 * @param event 已认证 API Key 且包含运行 UUID 的请求事件。
 * @returns 接受取消后的完整运行详情。
 * @remarks 要求 `generation:write` 权限和幂等键。
 */
export default defineEventHandler(async (event) => {
  const rawRunId = getRouterParam(event, 'runId')
  return await executePublicWriteController(event, 'generation:write', {
    payload: { runId: rawRunId }, targetType: 'generation_run', targetId: () => rawRunId ?? null, successStatusCode: 200,
  }, async () => toPublicJson(await event.context.applicationServices.generation.cancelRun(resourceIdSchema.parse(rawRunId))))
})
