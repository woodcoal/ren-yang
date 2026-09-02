import { getQuery } from 'h3'
import { publicListRunsQuerySchema } from '#shared/schemas/publicApi'
import { executePublicController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 查询图文运行历史。
 * @param event 已认证 API Key 且包含可选筛选条件的请求事件。
 * @returns 新运行在前的运行摘要。
 * @remarks 要求 `generation:read` 权限。
 */
export default defineEventHandler(async event => await executePublicController(event, 'generation:read', async () => {
  const input = publicListRunsQuerySchema.parse(getQuery(event))
  const personaId = input.personaId
    ? await event.context.applicationServices.content.resolvePersonaIdentifier(input.personaId)
    : undefined
  return toPublicJson(await event.context.applicationServices.generation.listRuns({ ...input, personaId }))
}))
