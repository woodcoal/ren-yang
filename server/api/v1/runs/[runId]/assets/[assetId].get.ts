import type { H3Event } from 'h3'
import { getQuery, getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { imageAssetVariantSchema } from '#shared/schemas/generation'
import { executeBinaryController } from '../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 已授权运行内的本地图片。 */
async function handleGetImageAsset(event: H3Event) {
  return await executeBinaryController(event, async () => {
    const runId = resourceIdSchema.parse(getRouterParam(event, 'runId'))
    const assetId = resourceIdSchema.parse(getRouterParam(event, 'assetId'))
    const variant = imageAssetVariantSchema.parse(getQuery(event).variant)
    return await event.context.applicationServices.generation.getImageAsset(runId, assetId, variant)
  })
}

export default defineEventHandler(handleGetImageAsset)
