import { z } from 'zod'
import {
  createPersonaSchema,
  createSourceWithTargetsSchema,
  createSourceLinkSchema,
  importSourceFileMetadataSchema,
  resourceIdSchema,
} from './content'
import { createGenerationRunSchema, createInterestBatchSchema, listRunsQuerySchema } from './generation'

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

/** 公共 API v2 使用的人物 UUID、用户名或邮箱。 */
export const publicPersonaIdentifierSchema = z.string().trim().toLowerCase()
  .min(1, '人物标识不能为空')
  .max(320, '人物标识不能超过 320 字')

/** 公共 API 创建人物时不开放人物账号密文能力。 */
export const publicCreatePersonaSchema = createPersonaSchema.omit({
  username: true,
  email: true,
  password: true,
})

/** 公共 API v2 创建兴趣批次的输入；人物可使用 UUID、用户名或邮箱。 */
export const publicCreateInterestBatchSchema = createInterestBatchSchema.safeExtend({
  personaId: publicPersonaIdentifierSchema,
})

/** 公共 API v2 创建图文运行的输入；人物可使用 UUID、用户名或邮箱。 */
export const publicCreateGenerationRunSchema = createGenerationRunSchema.extend({
  personaId: publicPersonaIdentifierSchema,
})

/** 公共 API v2 查询运行的输入；人物筛选可使用 UUID、用户名或邮箱。 */
export const publicListRunsQuerySchema = listRunsQuerySchema.extend({
  personaId: publicPersonaIdentifierSchema.optional(),
})

/** 公共 API v2 的资料初始目标；人物允许别名，世界继续只允许 UUID。 */
export const publicSourceCreationTargetSchema = z.discriminatedUnion('targetType', [
  z.object({ targetType: z.literal('persona'), targetId: publicPersonaIdentifierSchema }),
  z.object({ targetType: z.literal('world'), targetId: resourceIdSchema }),
])

/** 公共 API v2 创建粘贴资料的输入。 */
export const publicCreateSourceWithTargetsSchema = createSourceWithTargetsSchema.extend({
  targets: z.array(publicSourceCreationTargetSchema).default([]),
})

/** 公共 API v2 文件资料的元数据输入。 */
export const publicImportSourceFileMetadataSchema = importSourceFileMetadataSchema.extend({
  targets: z.array(publicSourceCreationTargetSchema).default([]),
})

/** 公共 API v2 创建单项资料关系的输入。 */
export const publicCreateSourceLinkSchema = z.discriminatedUnion('targetType', [
  createSourceLinkSchema.extend({ targetType: z.literal('persona'), targetId: publicPersonaIdentifierSchema }),
  createSourceLinkSchema.extend({ targetType: z.literal('world'), targetId: resourceIdSchema }),
])

/** 设置人物所属世界的输入；解除关系使用独立 DELETE 接口。 */
export const setPersonaWorldSchema = z.object({
  worldId: z.string().uuid('世界标识无效'),
})

export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>
