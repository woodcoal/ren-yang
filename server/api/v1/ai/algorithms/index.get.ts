import type { H3Event } from 'h3'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前已认证请求。 @returns 固定算法及当前配置。 */
async function handleListAiAlgorithms(event: H3Event) {
  return await executeController(event, async () => {
    return await event.context.applicationServices.aiConfiguration.listAlgorithms()
  })
}

export default defineEventHandler(handleListAiAlgorithms)
