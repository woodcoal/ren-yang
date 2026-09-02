import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema, updateLearningAutomationSchema } from '#shared/schemas/content'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 修改世界定时提炼并自动发布开关。
 * @param event 当前已认证管理员请求。
 * @returns 更新后的世界详情响应。
 */
async function handleUpdateWorldLearningAutomation(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.content.updateWorldLearningAutomation(
    resourceIdSchema.parse(getRouterParam(event, 'worldId')),
    updateLearningAutomationSchema.parse(await readBody(event)),
  ))
}

export default defineEventHandler(handleUpdateWorldLearningAutomation)
