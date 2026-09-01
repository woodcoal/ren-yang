import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 查询兴趣批次及全部顺序条目的当前结果。
 * @param event 已认证 API Key 且包含批次 UUID 的请求事件。
 * @returns 批次状态和逐项三态结果、概率、理由或错误。
 * @remarks 要求 `generation:read` 权限。
 */
export default defineEventHandler(async event => await executePublicController(event, 'generation:read', async () => toPublicJson(
  await event.context.applicationServices.generation.getInterestBatch(
    resourceIdSchema.parse(getRouterParam(event, 'batchId')),
  ),
)))
