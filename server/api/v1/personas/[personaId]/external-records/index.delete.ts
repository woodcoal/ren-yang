import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { deleteExternalRecordsSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 永久删除当前人物选中的第三方经历记录。
 * @param event 当前请求，包含人物 UUID 和记录 UUID 集合。
 * @returns 删除后的完整人物记忆工作区。
 */
async function handleDeleteExternalRecords(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = deleteExternalRecordsSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.deleteExternalRecords(personaId, input)
  })
}

export default defineEventHandler(handleDeleteExternalRecords)
