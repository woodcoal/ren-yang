import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { importGrowthSourcesSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 将人物资料库内容按逐条评分批量复制为人物成长素材快照。
 * @param event 当前 H3 请求，路径包含人物 UUID，请求体包含资料评分。
 * @returns 整批导入后的最新人物成长工作区响应。
 */
async function handleImportPersonaGrowth(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = importGrowthSourcesSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.importGrowthSources('persona', personaId, input)
  })
}

export default defineEventHandler(handleImportPersonaGrowth)
