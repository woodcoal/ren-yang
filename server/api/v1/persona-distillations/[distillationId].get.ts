import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 读取人物蒸馏的覆盖、候选、证据、评测和当前状态。
 * @param event 当前已认证请求。
 * @returns 完整人物蒸馏运行。
 */
async function handleGetPersonaDistillation(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.personaDistillation.getRun(
    resourceIdSchema.parse(getRouterParam(event, 'distillationId')),
  ))
}

export default defineEventHandler(handleGetPersonaDistillation)
