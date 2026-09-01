import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicController } from '../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 查询删除资料前的完整影响范围。
 * @param event 已认证 API Key 且包含资料 UUID 的请求事件。
 * @returns 可删除状态、阻断原因、关系、投影和原文件影响。
 * @remarks 要求 `library:read` 权限，本接口不执行删除。
 */
export default defineEventHandler(async event => await executePublicController(event, 'library:read', async () => toPublicJson(
  await event.context.applicationServices.content.getSourceDeletionImpact(resourceIdSchema.parse(getRouterParam(event, 'sourceId'))),
)))
