import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { searchSourcesSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 使用 SQLite FTS5 检索资料证据候选。
 * @param event 当前 H3 请求事件。
 * @returns 相关切片响应。
 */
async function handleSearchSources(event: H3Event) {
  return await executeController(event, async () => {
    const query = searchSourcesSchema.parse(getQuery(event))
    return await event.context.applicationServices.content.searchSources(query.query, query.limit)
  })
}

export default defineEventHandler(handleSearchSources)
