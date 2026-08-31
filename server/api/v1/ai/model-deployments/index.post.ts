import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { saveAiModelDeploymentSchema } from '#shared/schemas/aiConfiguration'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前已认证请求。 @returns 创建后的 AI 模型部署。 */
async function handleCreateAiModelDeployment(event: H3Event) {
  return await executeController(event, async () => {
    const input = saveAiModelDeploymentSchema.parse(await readBody(event))
    return await event.context.applicationServices.aiConfiguration.createModelDeployment(input)
  })
}

export default defineEventHandler(handleCreateAiModelDeployment)
