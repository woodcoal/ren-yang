import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { updatePersonasStatusSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 批量修改人物启用状态。
 * @param event 当前 H3 请求事件，请求体包含人物 UUID 集合和统一状态。
 * @returns 去重后的处理人物与新状态响应。
 */
async function handleUpdatePersonasStatus(event: H3Event) {
  return await executeController(event, async () => {
    const input = updatePersonasStatusSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.updatePersonasStatus(input)
  })
}

export default defineEventHandler(handleUpdatePersonasStatus)
