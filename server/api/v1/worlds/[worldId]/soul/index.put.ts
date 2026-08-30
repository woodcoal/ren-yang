import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, saveSoulVersionSchema } from '#shared/schemas/content'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 保存世界灵魂并立即生成新的当前历史版本。
 * @param event 当前已认证请求。
 * @returns 已经生效的世界灵魂版本。
 */
async function handleSaveWorldSoul(event: H3Event) {
  return await executeController(event, async () => {
    const worldId = resourceIdSchema.parse(getRouterParam(event, 'worldId'))
    const input = saveSoulVersionSchema.parse(await readBody(event))
    return await event.context.applicationServices.soul.saveVersion('world', worldId, input)
  })
}

export default defineEventHandler(handleSaveWorldSoul)
