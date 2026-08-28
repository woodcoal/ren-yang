import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/**
 * 返回不包含凭据的外部能力状态。
 * @param event 当前 H3 请求事件。
 * @returns 当前阶段外部能力摘要。
 */
async function handleCapabilities(event: H3Event) {
  return await executeController(event, async () => event.context.applicationServices.generation.getCapabilities())
}

export default defineEventHandler(handleCapabilities)
