import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicController } from '../../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../../presentation/http/publicJson'

/**
 * 查询人物灵魂工作区。
 * @param event 已认证 API Key 且包含人物 UUID 的请求事件。
 * @returns 当前发布版、唯一草稿和不可变版本历史。
 * @remarks 要求 `persona:read` 权限，不改变运行时灵魂。
 */
export default defineEventHandler(async event => await executePublicController(event, 'persona:read', async () => toPublicJson(
  await event.context.applicationServices.soul.getSoul('persona', resourceIdSchema.parse(getRouterParam(event, 'personaId'))),
)))
