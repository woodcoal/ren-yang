import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { saveExternalRecordSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 修改一条当前人物的第三方经历记录。
 * @param event 当前请求，包含人物与记录 UUID 以及完整新内容。
 * @returns 修改后的完整人物记忆工作区。
 */
async function handleUpdateExternalRecord(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const recordId = resourceIdSchema.parse(getRouterParam(event, 'recordId'))
    const input = saveExternalRecordSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.updateExternalRecord(personaId, recordId, input)
  })
}

export default defineEventHandler(handleUpdateExternalRecord)
