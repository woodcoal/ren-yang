import { readBody } from 'h3'
import { createWorldSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 创建世界并通过现有业务链发布初始灵魂。
 * @param event 已认证 API Key 且包含世界输入的请求事件。
 * @returns 创建完成后的世界详情。
 * @remarks 要求 `world:write` 权限和幂等键，不新增另一套发布规则。
 */
export default defineEventHandler(async (event) => {
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'world:write', {
    payload: body, targetType: 'world', successStatusCode: 201, targetId: data => readWorldId(data),
  }, async () => toPublicJson(await event.context.applicationServices.content.createWorld(createWorldSchema.parse(body))))
})

/** @param value 公共世界详情。 @returns 世界 UUID 或 null。 */
function readWorldId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const world = (value as Record<string, unknown>).world
  if (typeof world !== 'object' || world === null) return null
  const id = (world as Record<string, unknown>).id
  return typeof id === 'string' ? id : null
}
