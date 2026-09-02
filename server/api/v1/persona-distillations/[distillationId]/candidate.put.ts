import type { H3Event } from 'h3'
import { getRouterParam, readBody, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { savePersonaDistillationCandidateSchema } from '#shared/schemas/personaDistillation'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 保存人工编辑的人物候选并排入重新评测。
 * @param event 当前已认证请求。
 * @returns 已进入重新评测阶段的运行。
 */
async function handleSavePersonaDistillationCandidate(event: H3Event) {
  return await executeController(event, async () => {
    const saved = await event.context.applicationServices.personaDistillation.saveCandidate(
      resourceIdSchema.parse(getRouterParam(event, 'distillationId')),
      savePersonaDistillationCandidateSchema.parse(await readBody(event)),
    )
    setResponseStatus(event, 202)
    return saved
  })
}

export default defineEventHandler(handleSavePersonaDistillationCandidate)
