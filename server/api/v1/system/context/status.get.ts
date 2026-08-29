import type { H3Event } from 'h3'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns SQLite 保存的外部索引同步状态。 */
async function handleContextStatus(event: H3Event) {
  return await executeController(event, async () => ({
    capability: event.context.applicationServices.contextSynchronization.getCapability(),
    records: await event.context.applicationServices.contextSynchronization.listSyncRecords(),
  }))
}

export default defineEventHandler(handleContextStatus)
