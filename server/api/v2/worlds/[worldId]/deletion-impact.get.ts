import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicController } from '../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 查询删除世界前的完整影响范围。
 * @param event 已认证 API Key 且包含世界 UUID 的请求事件。
 * @returns 可删除状态、阻断原因、人物、资料和版本影响。
 * @remarks 要求 `world:read` 权限，本接口不执行删除。
 */
export default defineEventHandler(async event => await executePublicController(event, 'world:read', async () => toPublicJson(
  await event.context.applicationServices.content.getWorldDeletionImpact(resourceIdSchema.parse(getRouterParam(event, 'worldId'))),
)))
