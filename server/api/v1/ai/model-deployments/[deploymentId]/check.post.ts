import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { z } from 'zod'
import { executeController } from '../../../../../presentation/http/controller'

/** @param event 当前已认证请求。 @returns 真实最小请求得到的脱敏检测结果。 */
async function handleCheckAiModelDeployment(event: H3Event) {
  return await executeController(event, async () => {
    const deploymentId = z.string().uuid('模型部署标识无效').parse(getRouterParam(event, 'deploymentId'))
    return await event.context.applicationServices.aiConfiguration.checkModelDeployment(deploymentId)
  })
}

export default defineEventHandler(handleCheckAiModelDeployment)
