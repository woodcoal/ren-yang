import type { H3Event } from 'h3'
import { getRouterParam, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 永久删除无关联资料、切片、索引和原始文件。
 * @param event 当前 H3 请求事件。
 * @returns 204 空响应。
 */
async function handleDeleteSource(event: H3Event) {
  return await executeController(event, async () => {
    const sourceId = resourceIdSchema.parse(getRouterParam(event, 'sourceId'))
    await event.context.applicationServices.content.deleteSource(sourceId)
    setResponseStatus(event, 204)
  })
}

export default defineEventHandler(handleDeleteSource)
