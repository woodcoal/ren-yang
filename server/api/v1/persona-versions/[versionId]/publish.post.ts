import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 发布一个人物候选版本。
 * @param event 当前 H3 请求事件。
 * @returns 已发布版本响应。
 */
async function handlePublishPersonaVersion(event: H3Event) {
  return await executeController(event, async () => {
    const versionId = resourceIdSchema.parse(getRouterParam(event, 'versionId'))
    return await event.context.applicationServices.content.publishPersonaVersion(versionId)
  })
}

export default defineEventHandler(handlePublishPersonaVersion)
