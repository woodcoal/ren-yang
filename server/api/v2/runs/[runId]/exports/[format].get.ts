import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { artifactFormatSchema } from '#shared/schemas/generation'
import { executePublicBinaryController } from '../../../../../presentation/http/publicController'

/**
 * 下载运行的单文件或含图片资源包。
 * @param event 已认证 API Key 且包含运行 UUID 与格式的请求事件。
 * @returns 带安全文件名的导出字节。
 * @remarks 要求 `generation:read` 权限。
 */
export default defineEventHandler(async event => await executePublicBinaryController(event, 'generation:read', async () => {
  const runId = resourceIdSchema.parse(getRouterParam(event, 'runId'))
  const format = artifactFormatSchema.parse(getRouterParam(event, 'format'))
  const file = await event.context.applicationServices.generation.exportRun(runId, format)
  return { bytes: file.bytes, mediaType: file.mediaType, fileName: file.fileName }
}))
