import { getRouterParam } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { executePublicController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 查询单项资料的公共详情。
 * @param event 已认证 API Key 且包含资料 UUID 的请求事件。
 * @returns 资料正文、切片、人物/世界关系和全局状态。
 * @remarks 要求 `library:read` 权限，不返回内部语义投影。
 */
export default defineEventHandler(async event => await executePublicController(event, 'library:read', async () => toPublicJson(
  await event.context.applicationServices.content.getSource(resourceIdSchema.parse(getRouterParam(event, 'sourceId'))),
)))
