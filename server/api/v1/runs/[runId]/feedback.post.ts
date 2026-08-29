import type { H3Event } from 'h3'
import { getRouterParam, readBody, setResponseStatus } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { submitFeedbackSchema } from '#shared/schemas/feedback'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 保存运行反馈并返回文本模型分类建议。
 * @param event 当前请求。
 * @returns 尚待用户确认分类的反馈事件。
 */
async function handleSubmitFeedback(event: H3Event) {
  return await executeController(event, async () => {
    const runId = resourceIdSchema.parse(getRouterParam(event, 'runId'))
    const input = submitFeedbackSchema.parse(await readBody(event))
    const feedback = await event.context.applicationServices.feedback.submitFeedback(runId, input)
    setResponseStatus(event, 201)
    return feedback
  })
}

export default defineEventHandler(handleSubmitFeedback)
