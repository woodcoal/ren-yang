import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 为失败或部分成功运行创建整体重试任务。
 * @param event 已认证 API Key 且包含运行 UUID 的请求事件。
 * @returns 新任务标识和恢复后的运行状态。
 * @remarks 要求 `generation:write` 权限和幂等键，保留旧任务和尝试历史。
 */
export default defineEventHandler(async (event) => {
  const rawRunId = getRouterParam(event, 'runId')
  return await executePublicWriteController(event, 'generation:write', {
    payload: { runId: rawRunId }, targetType: 'generation_run', targetId: () => rawRunId ?? null, successStatusCode: 202,
  }, async () => toPublicJson(await event.context.applicationServices.generation.retryRun(resourceIdSchema.parse(rawRunId))))
})
