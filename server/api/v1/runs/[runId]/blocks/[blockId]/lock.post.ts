import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { setBlockLockSchema } from '#shared/schemas/generation'
import { executeController } from '../../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 更新锁定状态后的运行详情。 */
async function handleSetBlockLock(event: H3Event) {
  return await executeController(event, async () => {
    const runId = resourceIdSchema.parse(getRouterParam(event, 'runId'))
    const blockId = resourceIdSchema.parse(getRouterParam(event, 'blockId'))
    const input = setBlockLockSchema.parse(await readBody(event))
    return await event.context.applicationServices.generation.setBlockLock(runId, blockId, input.locked)
  })
}

export default defineEventHandler(handleSetBlockLock)
