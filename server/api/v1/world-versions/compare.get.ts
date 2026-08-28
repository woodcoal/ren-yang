import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { compareVersionsSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 返回两个世界版本的正文差异。
 * @param event 当前 H3 请求事件。
 * @returns 版本差异响应。
 */
async function handleCompareWorldVersions(event: H3Event) {
  return await executeController(event, async () => {
    const query = compareVersionsSchema.parse(getQuery(event))
    return await event.context.applicationServices.content.compareWorldVersions(query.base, query.target)
  })
}

export default defineEventHandler(handleCompareWorldVersions)
