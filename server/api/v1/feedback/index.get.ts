import type { H3Event } from 'h3'
import { executeController } from '../../../presentation/http/controller'

/** @param event 当前请求。 @returns 新反馈在前的反馈历史。 */
async function handleListFeedback(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.feedback.listFeedback())
}

export default defineEventHandler(handleListFeedback)
