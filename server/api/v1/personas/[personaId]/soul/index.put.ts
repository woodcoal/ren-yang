import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, saveSoulVersionSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 保存人物灵魂并立即生成新的当前历史版本。
 * @param event 当前已认证请求。
 * @returns 已经生效的人物灵魂版本。
 */
async function handleSavePersonaSoul(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = saveSoulVersionSchema.parse(await readBody(event))
    return await event.context.applicationServices.soul.saveVersion('persona', personaId, input)
  })
}

export default defineEventHandler(handleSavePersonaSoul)
