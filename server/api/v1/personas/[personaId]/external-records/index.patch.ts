import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { batchEnabledStateSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 批量修改人物第三方经历记录是否参加记忆提炼。
 * @param event 当前请求，包含人物 UUID、记录 UUID 集合和目标状态。
 * @returns 更新后的完整人物记忆工作区。
 */
async function handleUpdateExternalRecordStates(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = batchEnabledStateSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.updateExternalRecordStates(personaId, input)
  })
}

export default defineEventHandler(handleUpdateExternalRecordStates)
