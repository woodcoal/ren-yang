import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { compareVersionsSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 返回两个人物版本的字段级差异。
 * @param event 当前 H3 请求事件。
 * @returns 版本差异响应。
 */
async function handleComparePersonaVersions(event: H3Event) {
  return await executeController(event, async () => {
    const query = compareVersionsSchema.parse(getQuery(event))
    return await event.context.applicationServices.content.comparePersonaVersions(query.base, query.target)
  })
}

export default defineEventHandler(handleComparePersonaVersions)
