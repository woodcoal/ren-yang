import type { H3Event } from 'h3'
import { readBody } from 'h3'
import { updateSourcesStatusSchema } from '#shared/schemas/content'
import { executeController } from '../../../presentation/http/controller'

/**
 * 批量修改资料全局启用状态。
 * @param event 当前 H3 请求事件。
 * @returns 去重后的处理对象与新状态响应。
 */
async function handleUpdateSourcesStatus(event: H3Event) {
  return await executeController(event, async () => {
    const input = updateSourcesStatusSchema.parse(await readBody(event))
    return await event.context.applicationServices.content.updateSourcesStatus(input)
  })
}

export default defineEventHandler(handleUpdateSourcesStatus)
