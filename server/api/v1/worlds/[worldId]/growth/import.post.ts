import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { importGrowthSourcesSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 将世界资料按逐条评分批量导入世界成长候选。
 * @param event 当前 H3 请求，路径包含世界 UUID，请求体包含适用范围和资料评分。
 * @returns 整批导入后的最新世界成长工作区响应。
 */
async function handleImportWorldGrowth(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = importGrowthSourcesSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.importGrowthSources('world', worldId, input)
  })
}

export default defineEventHandler(handleImportWorldGrowth)
