import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicController } from '../../../../presentation/http/publicController'
import { toPublicJson } from '../../../../presentation/http/publicJson'

/**
 * 查询删除人物前的完整影响范围。
 * @param event 已认证 API Key 且包含人物 UUID 的请求事件。
 * @returns 可删除状态、阻断原因、引用、任务和文件影响。
 * @remarks 要求 `persona:read` 权限，本接口不执行删除。
 */
export default defineEventHandler(async event => await executePublicController(event, 'persona:read', async () => toPublicJson(
  await event.context.applicationServices.content.getPersonaDeletionImpact(resourceIdSchema.parse(getRouterParam(event, 'personaId'))),
)))
