import type { H3Event } from 'h3'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前已认证请求。 @returns 全部 AI 模型部署。 */
async function handleListAiModelDeployments(event: H3Event) {
  return await executeController(event, async () => {
    return await event.context.applicationServices.aiConfiguration.listModelDeployments()
  })
}

export default defineEventHandler(handleListAiModelDeployments)
