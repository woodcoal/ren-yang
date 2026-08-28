import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executeBinaryController } from '../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 已授权运行内的本地图片。 */
async function handleGetImageAsset(event: H3Event) {
  return await executeBinaryController(event, async () => {
    const runId = resourceIdSchema.parse(getRouterParam(event, 'runId'))
    const assetId = resourceIdSchema.parse(getRouterParam(event, 'assetId'))
    return await event.context.applicationServices.generation.getImageAsset(runId, assetId)
  })
}

export default defineEventHandler(handleGetImageAsset)
