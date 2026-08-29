import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { checkContextProviderSchema } from '#shared/schemas/context'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 外部上下文提供器实时健康检测结果。 */
async function handleCheckProvider(event: H3Event) {
  return await executeController(event, async () => {
    checkContextProviderSchema.parse(await readBody(event))
    return await event.context.applicationServices.contextSynchronization.checkProvider()
  })
}

export default defineEventHandler(handleCheckProvider)
