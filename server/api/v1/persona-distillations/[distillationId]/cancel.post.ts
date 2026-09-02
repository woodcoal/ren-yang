import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 请求协作式取消人物蒸馏运行。
 * @param event 当前已认证请求。
 * @returns 取消请求后的运行。
 */
async function handleCancelPersonaDistillation(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.personaDistillation.cancelRun(
    resourceIdSchema.parse(getRouterParam(event, 'distillationId')),
  ))
}

export default defineEventHandler(handleCancelPersonaDistillation)
