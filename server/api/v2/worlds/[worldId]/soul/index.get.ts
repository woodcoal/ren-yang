import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicController } from '../../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../../presentation/http/publicJson'

/**
 * 查询世界灵魂工作区。
 * @param event 已认证 API Key 且包含世界 UUID 的请求事件。
 * @returns 当前发布版、唯一草稿和不可变版本历史。
 * @remarks 要求 `world:read` 权限，不改变运行时灵魂。
 */
export default defineEventHandler(async event => await executePublicController(event, 'world:read', async () => toPublicJson(
  await event.context.applicationServices.soul.getSoul('world', resourceIdSchema.parse(getRouterParam(event, 'worldId'))),
)))
