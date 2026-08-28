import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { selectBlockAttemptSchema } from '#shared/schemas/generation'
import { executeController } from '../../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 选择成功尝试后的运行详情。 */
async function handleSelectBlockAttempt(event: H3Event) {
  return await executeController(event, async () => {
    const runId = resourceIdSchema.parse(getRouterParam(event, 'runId'))
    const blockId = resourceIdSchema.parse(getRouterParam(event, 'blockId'))
    const input = selectBlockAttemptSchema.parse(await readBody(event))
    return await event.context.applicationServices.generation.selectBlockAttempt(runId, blockId, input.attemptId)
  })
}

export default defineEventHandler(handleSelectBlockAttempt)
