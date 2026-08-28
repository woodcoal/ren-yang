import type { H3Event } from 'h3'
import { getRouterParam, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 为失败或部分成功运行创建新的持久任务，保留旧任务和尝试历史。
 * @param event 当前 H3 请求事件。
 * @returns 新任务标识和恢复后的运行状态。
 */
async function handleRetryRun(event: H3Event) {
  return await executeController(event, async () => {
    const runId = resourceIdSchema.parse(getRouterParam(event, 'runId'))
    const retried = await event.context.applicationServices.generation.retryRun(runId)
    setResponseStatus(event, 202)
    return retried
  })
}

export default defineEventHandler(handleRetryRun)
