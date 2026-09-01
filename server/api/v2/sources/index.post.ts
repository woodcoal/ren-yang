import { readBody } from 'h3'
import { createSourceWithTargetsSchema } from '#shared/schemas/content'
import { executePublicWriteController } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 创建粘贴文本资料并建立可选初始关系。
 * @param event 已认证 API Key 且包含资料正文与关系的请求事件。
 * @returns 创建、切片并关联后的资料详情。
 * @remarks 要求 `library:write` 权限和幂等键，继续触发现有投影同步。
 */
export default defineEventHandler(async (event) => {
  const body: unknown = await readBody(event)
  return await executePublicWriteController(event, 'library:write', {
    payload: body, targetType: 'source', successStatusCode: 201, targetId: data => readSourceId(data),
  }, async () => toPublicJson(await event.context.applicationServices.content.createPastedSource(
    createSourceWithTargetsSchema.parse(body),
  )))
})

/** @param value 公共资料详情。 @returns 资料 UUID 或 null。 */
function readSourceId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const source = (value as Record<string, unknown>).source
  if (typeof source !== 'object' || source === null) return null
  const id = (source as Record<string, unknown>).id
  return typeof id === 'string' ? id : null
}
