import { readBody } from 'h3'
import { publicCreatePersonaSchema } from '#shared/schemas/publicApi'
import { executePublicWriteController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 创建人物并通过现有业务链发布初始灵魂。
 * @param event 已认证 API Key 且包含人物输入的请求事件。
 * @returns 创建完成后的人物详情。
 * @remarks 要求 `persona:write` 权限和幂等键，不开放人物账号凭据。
 */
export default defineEventHandler(async (event) => {
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'persona:write', {
    payload: body,
    targetType: 'persona',
    successStatusCode: 201,
    targetId: data => readNestedId(data, 'persona'),
  }, async () => toPublicJson(await event.context.applicationServices.content.createPersona(
    publicCreatePersonaSchema.parse(body),
  )))
})

/** @param value 公共人物详情。 @param field 人物字段名。 @returns 人物 UUID 或 null。 */
function readNestedId(value: unknown, field: string): string | null {
  if (typeof value !== 'object' || value === null) return null
  const nested = (value as Record<string, unknown>)[field]
  if (typeof nested !== 'object' || nested === null) return null
  const id = (nested as Record<string, unknown>).id
  return typeof id === 'string' ? id : null
}
