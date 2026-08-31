import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { aiAlgorithmCodeSchema, publishAiAlgorithmConfigurationSchema } from '#shared/schemas/aiConfiguration'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前已认证请求。 @returns 发布新配置版本后的算法视图。 */
async function handlePublishAiAlgorithmConfiguration(event: H3Event) {
  return await executeController(event, async () => {
    const code = aiAlgorithmCodeSchema.parse(getRouterParam(event, 'code'))
    const input = publishAiAlgorithmConfigurationSchema.parse(await readBody(event))
    return await event.context.applicationServices.aiConfiguration.publishAlgorithmConfiguration(code, input)
  })
}

export default defineEventHandler(handlePublishAiAlgorithmConfiguration)
