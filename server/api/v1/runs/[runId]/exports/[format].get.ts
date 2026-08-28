import type { H3Event } from 'h3'
import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { artifactFormatSchema } from '#shared/schemas/generation'
import { executeBinaryController } from '../../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 单文档或含图片和清单的 ZIP。 */
async function handleExportArtifact(event: H3Event) {
  return await executeBinaryController(event, async () => {
    const runId = resourceIdSchema.parse(getRouterParam(event, 'runId'))
    const format = artifactFormatSchema.parse(getRouterParam(event, 'format'))
    const file = await event.context.applicationServices.generation.exportRun(runId, format)
    return { bytes: file.bytes, mediaType: file.mediaType, fileName: file.fileName }
  })
}

export default defineEventHandler(handleExportArtifact)
