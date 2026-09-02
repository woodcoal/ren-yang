import type { H3Event } from 'h3'
import { readBody, setResponseStatus } from 'h3'
import { createPersonaDistillationSchema } from '#shared/schemas/personaDistillation'
import { executeController } from '../../../presentation/http/controller'

/**
 * 创建人物蒸馏运行并排入资料覆盖评估。
 * @param event 当前已认证请求。
 * @returns 已排队的人物蒸馏运行。
 */
async function handleCreatePersonaDistillation(event: H3Event) {
  return await executeController(event, async () => {
    const created = await event.context.applicationServices.personaDistillation.createRun(
      createPersonaDistillationSchema.parse(await readBody(event)),
    )
    setResponseStatus(event, 202)
    return created
  })
}

export default defineEventHandler(handleCreatePersonaDistillation)
