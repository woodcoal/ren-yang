import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { confirmFeedbackClassificationSchema } from '#shared/schemas/feedback'
import { executeController } from '../../../../presentation/http/controller'

/** @param event 当前请求。 @returns 用户确认分类及目标动作结果。 */
async function handleConfirmClassification(event: H3Event) {
  return await executeController(event, async () => {
    const feedbackId = resourceIdSchema.parse(getRouterParam(event, 'feedbackId'))
    const input = confirmFeedbackClassificationSchema.parse(await readBody(event))
    return await event.context.applicationServices.feedback.confirmClassification(feedbackId, input)
  })
}

export default defineEventHandler(handleConfirmClassification)
