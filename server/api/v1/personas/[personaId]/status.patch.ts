import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, updatePersonaStatusSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 修改单个人物启用状态。
 * @param event 当前 H3 请求事件，路径包含人物 UUID，请求体包含新状态。
 * @returns 保留版本、资料和历史记录的最新人物详情响应。
 */
async function handleUpdatePersonaStatus(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = updatePersonaStatusSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.updatePersonaStatus(personaId, input)
  })
}

export default defineEventHandler(handleUpdatePersonaStatus)
