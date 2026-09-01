import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 查询单次生成运行的完整状态与结果。
 * @param event 已认证 API Key 且包含运行 UUID 的请求事件。
 * @returns 运行、证据、内部文档结果、块尝试与任务状态。
 * @remarks 要求 `generation:read` 权限。
 */
export default defineEventHandler(async event => await executePublicController(event, 'generation:read', async () => toPublicJson(
  await event.context.applicationServices.generation.getRun(resourceIdSchema.parse(getRouterParam(event, 'runId'))),
)))
