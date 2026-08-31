import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { retryContextSyncSchema } from '#shared/schemas/context'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 重新安排全部失败投影，或一项资料实体的失败投影。
 * @param event 当前已认证后台请求。
 * @returns 去重后重新排队的资料实体数量。
 */
async function handleContextRetry(event: H3Event) {
  return await executeController(event, async () => {
    const input = retryContextSyncSchema.parse(await readBody(event))
    return await event.context.applicationServices.contextSynchronization.retryFailedSync(
      input.scope === 'entity' ? { entityType: input.entityType, sourceId: input.sourceId } : undefined,
    )
  })
}

export default defineEventHandler(handleContextRetry)
