import type { H3Event } from 'h3'
import { getQuery } from 'h3'
import { listSubjectsPageSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 分页查询人物管理列表。
 * @param event 当前 H3 请求事件，查询参数包含页码和每页数量。
 * @returns 包含当前页、总数和总页数的人物摘要响应。
 */
async function handleListPersonasPage(event: H3Event) {
  return await executeController(event, async () => {
    const input = listSubjectsPageSchema.parse(getQuery(event))
    return await event.context.applicationServices.content.listPersonasPage(input)
  })
}

export default defineEventHandler(handleListPersonasPage)
