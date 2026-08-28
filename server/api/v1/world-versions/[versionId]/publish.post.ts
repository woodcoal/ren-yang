import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 发布一个世界候选版本。
 * @param event 当前 H3 请求事件。
 * @returns 已发布版本响应。
 */
async function handlePublishWorldVersion(event: H3Event) {
  return await executeController(event, async () => {
    const versionId = resourceIdSchema.parse(getRouterParam(event, 'versionId'))
    return await event.context.applicationServices.content.publishWorldVersion(versionId)
  })
}

export default defineEventHandler(handlePublishWorldVersion)
