import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { updateGrowthMaterialSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 修改人物成长素材的标题、正文快照和评分。
 * @param event 当前 H3 请求，路径包含人物和素材 UUID，请求体包含新内容。
 * @returns 修改后的人物成长工作区响应。
 */
async function handleUpdatePersonaGrowth(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const growthId = resourceIdSchema.parse(getRouterParam(event, 'growthId'))
    const input = updateGrowthMaterialSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.updateGrowthMaterial('persona', personaId, growthId, input)
  })
}

export default defineEventHandler(handleUpdatePersonaGrowth)
