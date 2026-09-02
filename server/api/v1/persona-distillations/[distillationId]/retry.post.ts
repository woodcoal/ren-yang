import type { H3Event } from 'h3'
import { getRouterParam, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 从失败运行的固定输入和算法快照创建新人物蒸馏运行。
 * @param event 当前已认证请求。
 * @returns 新资料评估运行。
 */
async function handleRetryPersonaDistillation(event: H3Event) {
  return await executeController(event, async () => {
    const retried = await event.context.applicationServices.personaDistillation.retryRun(
      resourceIdSchema.parse(getRouterParam(event, 'distillationId')),
    )
    setResponseStatus(event, 202)
    return retried
  })
}

export default defineEventHandler(handleRetryPersonaDistillation)
