import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { deleteGrowthSchema } from '#shared/schemas/learning'
import { executeController } from '../../../../../presentation/http/controller'

/**
 * 批量永久删除人物成长及其全部历史修订。
 * @param event 当前 H3 请求，路径包含人物 UUID，请求体包含成长 UUID 集合。
 * @returns 原子删除后的最新人物成长工作区响应。
 */
async function handleDeletePersonaGrowth(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const input = deleteGrowthSchema.parse(await readBody(event))
    return await event.context.applicationServices.learning.deleteGrowth('persona', personaId, input)
  })
}

export default defineEventHandler(handleDeletePersonaGrowth)
