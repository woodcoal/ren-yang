import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { updateOperationRecordSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 修改人物单条历史任务记忆素材的提炼评分。
 * @param event 当前请求，路径包含人物与历史任务记录 UUID。
 * @returns 修改评分后的人物记忆工作区。
 */
async function handleUpdateOperationRecord(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const recordId = resourceIdSchema.parse(getRouterParam(event, 'recordId'))
    const input = updateOperationRecordSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.updateOperationRecordImportance(personaId, recordId, input)
  })
}

export default defineEventHandler(handleUpdateOperationRecord)
