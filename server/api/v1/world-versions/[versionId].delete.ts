import type { H3Event } from 'h3'
import { getRouterParam, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 永久删除一个未使用的错误世界版本。
 * @param event 当前 H3 请求事件，路径中包含世界版本 UUID。
 * @returns 删除成功后返回 204 空响应。
 */
async function handleDeleteWorldVersion(event: H3Event) {
  return await executeController(event, async () => {
    const versionId = resourceIdSchema.parse(getRouterParam(event, 'versionId'))
    await event.context.applicationServices.content.deleteWorldVersion(versionId)
    setResponseStatus(event, 204)
  })
}

export default defineEventHandler(handleDeleteWorldVersion)
