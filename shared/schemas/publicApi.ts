import { z } from 'zod'
import { createPersonaSchema } from './content'

/** 当前公共 API 已开放的最小权限范围。 */
export const apiKeyScopeSchema = z.enum([
  'persona:read',
  'persona:write',
  'world:read',
  'world:write',
  'library:read',
  'library:write',
  'generation:read',
  'generation:write',
])

/** 管理员创建 API Key 的输入。 */
export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Key 名称不能为空').max(100, 'Key 名称不能超过 100 字'),
  scopes: z.array(apiKeyScopeSchema)
    .min(1, '至少选择一个权限范围')
    .max(8, '权限范围数量无效')
    .refine(scopes => new Set(scopes).size === scopes.length, '权限范围不能重复'),
  expiresAt: z.iso.datetime({ offset: true, error: '到期时间必须是带时区的 ISO 8601 时间' }).nullable().default(null),
})

/** API Key 资源路径参数。 */
export const apiKeyIdSchema = z.string().uuid('API Key 标识无效')

/** 公共写请求使用的幂等键。 */
export const idempotencyKeySchema = z.string().trim().min(1, '幂等键不能为空').max(200, '幂等键不能超过 200 字')

/** 公共 API 创建人物时不开放人物账号密文能力。 */
export const publicCreatePersonaSchema = createPersonaSchema.omit({
  username: true,
  email: true,
  password: true,
})

/** 设置人物所属世界的输入；解除关系使用独立 DELETE 接口。 */
export const setPersonaWorldSchema = z.object({
  worldId: z.string().uuid('世界标识无效'),
})

export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>
