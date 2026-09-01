import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 查询单个世界的公共详情。
 * @param event 已认证 API Key 且包含世界 UUID 的请求事件。
 * @returns 世界详情、人物关系、灵魂版本和资料关系。
 * @remarks 要求 `world:read` 权限并复用现有详情用例。
 */
export default defineEventHandler(async event => await executePublicController(event, 'world:read', async () => toPublicJson(
  await event.context.applicationServices.content.getWorld(resourceIdSchema.parse(getRouterParam(event, 'worldId'))),
)))
