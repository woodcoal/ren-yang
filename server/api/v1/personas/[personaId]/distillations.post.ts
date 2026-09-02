import type { H3Event } from 'h3'
import { getRouterParam, readBody, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { restartPersonaDistillationSchema } from '#shared/schemas/personaDistillation'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 为已有人物创建一次可恢复的重新蒸馏运行。
 * @param event 当前已认证请求，包含人物 UUID、聚焦方向和可选资料。
 * @returns 已排队且最终只会更新当前人物的蒸馏运行。
 */
async function handleRestartPersonaDistillation(event: H3Event) {
  return await executeController(event, async () => {
    const created = await event.context.applicationServices.personaDistillation.restartRun(
      resourceIdSchema.parse(getRouterParam(event, 'personaId')),
      restartPersonaDistillationSchema.parse(await readBody(event)),
    )
    setResponseStatus(event, 202)
    return created
  })
}

export default defineEventHandler(handleRestartPersonaDistillation)
