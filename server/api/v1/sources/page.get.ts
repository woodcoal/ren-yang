import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { listSourcesPageSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 分页查询资料列表。
 * @param event 当前 H3 请求事件。
 * @returns 包含当前页、总数和总页数的资料摘要响应。
 */
async function handleListSourcesPage(event: H3Event) {
  return await executeController(event, async () => {
    const input = listSourcesPageSchema.parse(getQuery(event))
    return await event.context.applicationServices.content.listSourcesPage(input)
  })
}

export default defineEventHandler(handleListSourcesPage)
