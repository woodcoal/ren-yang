import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicBinaryController } from '../../../../../presentation/http/publicController'

/**
 * 读取运行引用的受控图片资产。
 * @param event 已认证 API Key 且包含运行与资产 UUID 的请求事件。
 * @returns 已校验媒体类型的图片字节。
 * @remarks 要求 `generation:read` 权限。
 */
export default defineEventHandler(async event => await executePublicBinaryController(event, 'generation:read', async () => {
  const runId = resourceIdSchema.parse(getRouterParam(event, 'runId'))
  const assetId = resourceIdSchema.parse(getRouterParam(event, 'assetId'))
  return await event.context.applicationServices.generation.getImageAsset(runId, assetId)
}))
