import { z } from 'zod'

/** 人物来源模式校验。 */
export const personaOriginSchema = z.enum(['original', 'source_based', 'hybrid'], { error: '人物来源模式无效' })

/** 资料角色校验。 */
export const sourceRoleSchema = z.enum(['canon_fact', 'reference', 'style_sample'], { error: '资料角色无效' })

/** 人物档案快照校验。 */
export const personaSnapshotSchema = z.object({
  summary: z.string().trim().min(1, '人物定位不能为空').max(2_000, '人物定位不能超过 2000 字'),
  identityFacts: z.string().trim().max(20_000, '身份事实不能超过 20000 字'),
  interests: z.string().trim().max(20_000, '兴趣偏好不能超过 20000 字'),
  valuesAndMotivations: z.string().trim().max(20_000, '价值与动机不能超过 20000 字'),
  expressionStyle: z.string().trim().max(20_000, '表达风格不能超过 20000 字'),
  appearance: z.string().trim().max(20_000, '外观描述不能超过 20000 字'),
  visualStyle: z.string().trim().max(20_000, '视觉风格不能超过 20000 字'),
  constraints: z.string().trim().max(20_000, '约束不能超过 20000 字'),
})

/** 从自然语言生成人物候选草稿的输入。 */
export const generatePersonaDraftSchema = z.object({
  prompt: z.string().trim().min(1, '自然语言人设不能为空').max(20_000, '自然语言人设不能超过 20000 字'),
  origin: personaOriginSchema,
  worldId: z.string().uuid('世界标识无效').nullable().optional(),
  sourceIds: z.array(z.string().uuid('资料标识无效')).max(8, '一次最多使用 8 项参考资料').default([]),
})

/** 文本模型返回且仍需用户确认的人物候选草稿。 */
export const personaDraftSchema = z.object({
  name: z.string().trim().min(1, '人物名称不能为空').max(100, '人物名称不能超过 100 字'),
  snapshot: personaSnapshotSchema,
})

/** 世界设定快照校验。 */
export const worldSnapshotSchema = z.object({
  content: z.string().trim().min(1, '世界设定正文不能为空').max(100_000, '世界设定正文不能超过 100000 字'),
})

/** 创建人物及其初始候选版本的输入。 */
export const createPersonaSchema = z.object({
  name: z.string().trim().min(1, '人物名称不能为空').max(100, '人物名称不能超过 100 字'),
  origin: personaOriginSchema,
  worldId: z.string().uuid('世界标识无效').nullable().optional(),
  sourceIds: z.array(z.string().uuid('资料标识无效')).max(100, '一次最多关联 100 项资料').default([]),
  snapshot: personaSnapshotSchema,
  changeSummary: z.string().trim().min(1, '变化摘要不能为空').max(500, '变化摘要不能超过 500 字'),
})

/** 修改人物可变元数据的输入。 */
export const updatePersonaSchema = z.object({
  name: z.string().trim().min(1, '人物名称不能为空').max(100, '人物名称不能超过 100 字'),
  worldId: z.string().uuid('世界标识无效').nullable(),
})

/** 创建人物候选版本的输入。 */
export const createPersonaVersionSchema = z.object({
  baseVersionId: z.string().uuid('基础版本标识无效').nullable(),
  snapshot: personaSnapshotSchema,
  changeSummary: z.string().trim().min(1, '变化摘要不能为空').max(500, '变化摘要不能超过 500 字'),
})

/** 回滚人物当前版本的输入。 */
export const rollbackPersonaSchema = z.object({
  versionId: z.string().uuid('版本标识无效'),
})

/** 创建世界设定及其初始候选版本的输入。 */
export const createWorldSchema = z.object({
  name: z.string().trim().min(1, '世界名称不能为空').max(100, '世界名称不能超过 100 字'),
  summary: z.string().trim().max(2_000, '世界摘要不能超过 2000 字').default(''),
  snapshot: worldSnapshotSchema,
  changeSummary: z.string().trim().min(1, '变化摘要不能为空').max(500, '变化摘要不能超过 500 字'),
})

/** 修改世界设定可变元数据的输入。 */
export const updateWorldSchema = z.object({
  name: z.string().trim().min(1, '世界名称不能为空').max(100, '世界名称不能超过 100 字'),
  summary: z.string().trim().max(2_000, '世界摘要不能超过 2000 字'),
})

/** 创建世界候选版本的输入。 */
export const createWorldVersionSchema = z.object({
  baseVersionId: z.string().uuid('基础版本标识无效').nullable(),
  snapshot: worldSnapshotSchema,
  changeSummary: z.string().trim().min(1, '变化摘要不能为空').max(500, '变化摘要不能超过 500 字'),
})

/** 回滚世界当前版本的输入。 */
export const rollbackWorldSchema = z.object({
  versionId: z.string().uuid('版本标识无效'),
})

/** 创建粘贴文本资料的输入。 */
export const createSourceSchema = z.object({
  name: z.string().trim().min(1, '资料名称不能为空').max(200, '资料名称不能超过 200 字'),
  role: sourceRoleSchema,
  content: z.string().min(1, '资料正文不能为空').max(2_000_000, '资料正文不能超过 2000000 字'),
})

/** 文件资料 multipart 元数据校验。 */
export const importSourceFileMetadataSchema = z.object({
  name: z.string().trim().min(1, '资料名称不能为空').max(200, '资料名称不能超过 200 字'),
  role: sourceRoleSchema,
})

/** 修改资料元数据与正文的输入。 */
export const updateSourceSchema = createSourceSchema

/** 创建资料关联的输入。 */
export const createSourceLinkSchema = z.object({
  targetType: z.enum(['persona', 'world'], { error: '关联目标类型无效' }),
  targetId: z.string().uuid('关联目标标识无效'),
  priority: z.number().int('优先级必须是整数').min(0, '优先级不能小于 0').max(10_000, '优先级不能超过 10000').default(100),
})

/** 删除资料关联的路径参数。 */
export const deleteSourceLinkSchema = z.object({
  sourceId: z.string().uuid('资料标识无效'),
  linkId: z.string().min(1, '关联标识不能为空'),
})

/** 资源 UUID 路径参数。 */
export const resourceIdSchema = z.string().uuid('资源标识无效')

/** FTS5 资料查询参数。 */
export const searchSourcesSchema = z.object({
  query: z.string().trim().min(1, '检索词不能为空').max(200, '检索词不能超过 200 字'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

/** 两个不可变版本的差异查询参数。 */
export const compareVersionsSchema = z.object({
  base: z.string().uuid('基础版本标识无效'),
  target: z.string().uuid('目标版本标识无效'),
})

export type CreatePersonaInput = z.infer<typeof createPersonaSchema>
export type GeneratePersonaDraftInput = z.infer<typeof generatePersonaDraftSchema>
export type PersonaDraft = z.infer<typeof personaDraftSchema>
export type UpdatePersonaInput = z.infer<typeof updatePersonaSchema>
export type CreatePersonaVersionInput = z.infer<typeof createPersonaVersionSchema>
export type CreateWorldInput = z.infer<typeof createWorldSchema>
export type UpdateWorldInput = z.infer<typeof updateWorldSchema>
export type CreateWorldVersionInput = z.infer<typeof createWorldVersionSchema>
export type CreateSourceInput = z.infer<typeof createSourceSchema>
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>
export type CreateSourceLinkInput = z.infer<typeof createSourceLinkSchema>
