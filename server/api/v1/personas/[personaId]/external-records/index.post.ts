import type { H3Event } from 'h3'
import { getRouterParam, readBody, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { saveExternalRecordSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 新建一条可参与人物记忆提炼的第三方经历记录。
 * @param event 当前请求，包含人物 UUID 和完整记录正文。
 * @returns 创建后的完整人物记忆工作区。
 */
async function handleCreateExternalRecord(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = saveExternalRecordSchema.parse(await readBody(event))
    const workspace = await event.context.applicationServices.learning.createExternalRecord(personaId, input)
    setResponseStatus(event, 201)
    return workspace
  })
}

export default defineEventHandler(handleCreateExternalRecord)
