import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 查询人物的不可变版本列表。
 * @param event 当前 H3 请求事件。
 * @returns 人物版本列表响应。
 */
async function handleListPersonaVersions(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    return (await event.context.applicationServices.content.getPersona(personaId)).versions
  })
}

export default defineEventHandler(handleListPersonaVersions)
