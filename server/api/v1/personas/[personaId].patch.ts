import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, updatePersonaSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 修改人物可变元数据。
 * @param event 当前 H3 请求事件。
 * @returns 更新后人物详情响应。
 */
async function handleUpdatePersona(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = updatePersonaSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.updatePersona(personaId, input)
  })
}

export default defineEventHandler(handleUpdatePersona)
