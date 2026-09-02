import type { H3Event } from 'h3'
import { getRouterParam, readBody, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { confirmPersonaDistillationCandidateSchema } from '#shared/schemas/personaDistillation'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 确认已通过对应哈希评测的候选并原子创建人物。
 * @param event 当前已认证请求。
 * @returns 已完成人物创建的蒸馏运行。
 */
async function handleConfirmPersonaDistillation(event: H3Event) {
  return await executeController(event, async () => {
    const confirmed = await event.context.applicationServices.personaDistillation.confirmCandidate(
      resourceIdSchema.parse(getRouterParam(event, 'distillationId')),
      confirmPersonaDistillationCandidateSchema.parse(await readBody(event)),
    )
    setResponseStatus(event, 201)
    return confirmed
  })
}

export default defineEventHandler(handleConfirmPersonaDistillation)
