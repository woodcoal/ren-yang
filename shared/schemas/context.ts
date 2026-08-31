import { z } from 'zod'

/** 当前可主动检测的外部上下文提供器。 */
export const checkContextProviderSchema = z.object({
  provider: z.literal('openviking'),
})
/** 重建请求必须明确目标提供器，避免误删其他索引。 */
export const reindexContextSchema = z.object({
  provider: z.literal('openviking'),
  confirmed: z.literal(true, { error: '重建索引前必须明确确认' }),
})

/** 管理员可以重试全部失败投影，或指定一项资料实体。 */
export const retryContextSyncSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('all') }),
  z.object({
    scope: z.literal('entity'),
    entityType: z.enum(['source_material', 'persona_feedback_source']),
    sourceId: z.string().trim().min(1).max(200),
  }),
])

/** OpenViking 服务地址不允许夹带凭据、查询参数或片段。 */
const openVikingEndpointSchema = z.union([
  z.literal(''),
  z.url('OpenViking 服务地址无效').max(2_000).superRefine((value, context) => {
    const endpoint = new URL(value)
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      context.addIssue({ code: 'custom', message: 'OpenViking 地址必须是无凭据、查询参数和片段的 HTTP(S) 地址' })
    }
  }),
])

/** 管理员保存的 OpenViking 运行配置；省略 API Key 表示保留数据库密文。 */
export const updateOpenVikingSettingsSchema = z.object({
  enabled: z.boolean(),
  endpoint: openVikingEndpointSchema,
  apiKey: z.string().trim().min(1, 'ADMIN Key 不能为空').max(8_000).optional(),
  timeoutMs: z.number().int().min(1_000, '超时不能少于 1000 毫秒').max(300_000, '超时不能超过 300000 毫秒'),
}).superRefine((value, context) => {
  if (value.enabled && !value.endpoint) {
    context.addIssue({ code: 'custom', path: ['endpoint'], message: '启用 OpenViking 前必须填写服务地址' })
  }
})

export type UpdateOpenVikingSettingsInput = z.infer<typeof updateOpenVikingSettingsSchema>
