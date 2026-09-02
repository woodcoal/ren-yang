import type { H3Event } from 'h3'
import { getRouterParam, readBody } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { reviewPersonaDistillationSourcesSchema } from '#shared/schemas/personaDistillation'
import { executeController } from '../../../../presentation/http/controller'

/**
 * 确认人物蒸馏资料范围与分类纠正并启动认知提取。
 * @param event 当前已认证请求。
 * @returns 已进入认知提取阶段的运行。
 */
async function handleReviewPersonaDistillationSources(event: H3Event) {
  return await executeController(event, async () => await event.context.applicationServices.personaDistillation.reviewSources(
    resourceIdSchema.parse(getRouterParam(event, 'distillationId')),
    reviewPersonaDistillationSourcesSchema.parse(await readBody(event)),
  ))
}

export default defineEventHandler(handleReviewPersonaDistillationSources)
