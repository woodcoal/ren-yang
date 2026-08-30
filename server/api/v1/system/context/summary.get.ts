import type { H3Event } from 'h3'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 返回系统中心需要的外部上下文同步摘要，避免读取完整同步日志。
 * @param event 当前 H3 请求事件。
 * @returns 外部上下文能力与失败记录数量。
 */
async function handleContextSummary(event: H3Event) {
  return await executeController(event, async () => ({
    capability: event.context.applicationServices.contextSynchronization.getCapability(),
    failedCount: await event.context.applicationServices.contextSynchronization.countFailedSyncRecords(),
  }))
}

export default defineEventHandler(handleContextSummary)
