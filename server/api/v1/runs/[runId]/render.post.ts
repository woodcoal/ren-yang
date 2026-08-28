import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { renderArtifactSchema } from '#shared/schemas/generation'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 同一组选中块的安全多格式预览。 */
async function handleRenderArtifact(event: H3Event) {
  return await executeController(event, async () => {
    const runId = resourceIdSchema.parse(getRouterParam(event, 'runId'))
    const input = renderArtifactSchema.parse(await readBody(event))
    return await event.context.applicationServices.generation.renderRun(runId, input.formats)
  })
}

export default defineEventHandler(handleRenderArtifact)
