import { z, type RefinementCtx } from 'zod'

/** 不得进入人物或世界实际提示词的创建流程元话术。 */
const initializationMetaPhrases = ['候选草稿', '待用户编辑确认', '待用户确认', '尚未发布', '不代表已影响', '不会自动发布', 'AI 生成']

/**
 * 拒绝把应用创建流程状态混入模型生成的实际提示词。
 * @param values 需要进入人物或世界的模型文本字段。
 * @param context Zod 精细校验上下文，用于返回可重试的结构错误。
 * @returns 无返回值；命中元话术时向校验上下文添加错误。
 * @remarks 只匹配明确的应用流程短语，避免删改或清洗模型输出导致语义残缺。
 */
function rejectInitializationMetaText(values: string[], context: RefinementCtx): void {
  if (!values.some(value => initializationMetaPhrases.some(phrase => value.includes(phrase)))) return
  context.addIssue({ code: 'custom', message: '生成内容不能包含候选、确认或发布等创建流程说明' })
}

/** 人物来源模式校验。 */
export const personaOriginSchema = z.enum(['original', 'source_based', 'hybrid'], { error: '人物来源模式无效' })

/** 资料角色校验。 */
export const sourceRoleSchema = z.enum(['canon_fact', 'reference', 'style_sample'], { error: '资料角色无效' })

/** 单个自由灵魂章节校验。 */
export const soulChapterSchema = z.object({
  id: z.string().uuid('章节标识无效'),
  title: z.string().trim().min(1, '章节标题不能为空').max(100, '章节标题不能超过 100 字'),
  content: z.string().trim().min(1, '章节正文不能为空').max(50_000, '单个章节不能超过 50000 字'),
  order: z.number().int('章节顺序必须是整数').min(0, '章节顺序不能小于 0'),
  required: z.boolean(),
})

/** 世界与人物共用的灵魂快照校验。 */
export const soulSnapshotSchema = z.object({
  chapters: z.array(soulChapterSchema).min(1, '至少需要一个灵魂章节').max(50, '灵魂章节不能超过 50 个'),
  runtimeSummary: z.string().trim().min(1, '运行摘要不能为空').max(50_000, '运行摘要不能超过 50000 字'),
})

/** 人物灵魂快照校验。 */
export const personaSnapshotSchema = soulSnapshotSchema

/** 世界与人物快速初始化共用的自然语言输入。 */
export const subjectInitializationSchema = z.object({
  prompt: z.string().trim().min(1, '自然语言描述不能为空').max(20_000, '自然语言描述不能超过 20000 字'),
})

/** 从自然语言生成人物候选草稿的输入。 */
export const generatePersonaDraftSchema = subjectInitializationSchema.extend({
  origin: personaOriginSchema,
  worldId: z.string().uuid('世界标识无效').nullable().optional(),
  sourceIds: z.array(z.string().uuid('资料标识无效')).max(8, '一次最多使用 8 项参考资料').default([]),
})

/** 文本模型返回且仍需用户确认的人物候选草稿。 */
export const personaDraftSchema = z.object({
  name: z.string().trim().min(1, '人物名称不能为空').max(100, '人物名称不能超过 100 字'),
  snapshot: personaSnapshotSchema,
}).superRefine((value, context) => {
  rejectInitializationMetaText([
    value.snapshot.runtimeSummary,
    ...value.snapshot.chapters.flatMap(chapter => [chapter.title, chapter.content]),
  ], context)
})

/** 从自然语言生成世界候选草稿的输入。 */
export const generateWorldDraftSchema = subjectInitializationSchema

/** 世界灵魂快照校验。 */
export const worldSnapshotSchema = soulSnapshotSchema

/** 文本模型返回且仍需用户确认的世界候选草稿。 */
export const worldDraftSchema = z.object({
  name: z.string().trim().min(1, '世界名称不能为空').max(100, '世界名称不能超过 100 字'),
  summary: z.string().trim().max(2_000, '世界摘要不能超过 2000 字'),
  snapshot: worldSnapshotSchema,
}).superRefine((value, context) => {
  rejectInitializationMetaText([
    value.summary,
    value.snapshot.runtimeSummary,
    ...value.snapshot.chapters.flatMap(chapter => [chapter.title, chapter.content]),
  ], context)
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

/** 修改人物启用状态的输入。 */
export const updatePersonaStatusSchema = z.object({
  isEnabled: z.boolean({ error: '人物状态必须是布尔值' }),
})

/** 批量修改人物启用状态的输入。 */
export const updatePersonasStatusSchema = updatePersonaStatusSchema.extend({
  personaIds: z.array(z.string().uuid('人物标识无效'))
    .min(1, '至少选择一个人物')
    .max(100, '一次最多修改 100 个人物'),
})

/** 保存人物灵魂草稿的兼容输入。 */
export const createPersonaVersionSchema = z.object({
  baseVersionId: z.string().uuid('基础版本标识无效').nullable(),
  snapshot: personaSnapshotSchema,
  changeSummary: z.string().trim().min(1, '变化摘要不能为空').max(500, '变化摘要不能超过 500 字'),
})

/** 回滚人物当前版本的输入。 */
export const rollbackPersonaSchema = z.object({
  versionId: z.string().uuid('版本标识无效'),
})

/** 创建世界及其初始候选版本的输入。 */
export const createWorldSchema = z.object({
  name: z.string().trim().min(1, '世界名称不能为空').max(100, '世界名称不能超过 100 字'),
  summary: z.string().trim().max(2_000, '世界摘要不能超过 2000 字').default(''),
  snapshot: worldSnapshotSchema,
  changeSummary: z.string().trim().min(1, '变化摘要不能为空').max(500, '变化摘要不能超过 500 字'),
})

/** 修改世界可变元数据的输入。 */
export const updateWorldSchema = z.object({
  name: z.string().trim().min(1, '世界名称不能为空').max(100, '世界名称不能超过 100 字'),
  summary: z.string().trim().max(2_000, '世界摘要不能超过 2000 字'),
})

/** 修改世界启用状态的输入。 */
export const updateWorldStatusSchema = z.object({
  isEnabled: z.boolean({ error: '世界状态必须是布尔值' }),
})

/** 批量修改世界启用状态的输入。 */
export const updateWorldsStatusSchema = updateWorldStatusSchema.extend({
  worldIds: z.array(z.string().uuid('世界标识无效'))
    .min(1, '至少选择一个世界')
    .max(100, '一次最多修改 100 个世界'),
})

/** 保存世界灵魂草稿的兼容输入。 */
export const createWorldVersionSchema = z.object({
  baseVersionId: z.string().uuid('基础版本标识无效').nullable(),
  snapshot: worldSnapshotSchema,
  changeSummary: z.string().trim().min(1, '变化摘要不能为空').max(500, '变化摘要不能超过 500 字'),
})

/** 回滚世界当前版本的输入。 */
export const rollbackWorldSchema = z.object({
  versionId: z.string().uuid('版本标识无效'),
})

/** 创建或覆盖当前对象唯一灵魂草稿的输入。 */
export const saveSoulDraftSchema = z.object({
  baseVersionId: z.string().uuid('基础版本标识无效').nullable(),
  snapshot: soulSnapshotSchema,
  changeSummary: z.string().trim().min(1, '修改说明不能为空').max(500, '修改说明不能超过 500 字'),
})

/** 从历史版本建立可编辑灵魂草稿的输入。 */
export const createSoulDraftFromVersionSchema = z.object({
  versionId: z.string().uuid('历史版本标识无效'),
})

/** 创建粘贴文本资料的输入。 */
export const createSourceSchema = z.object({
  name: z.string().trim().min(1, '资料名称不能为空').max(200, '资料名称不能超过 200 字'),
  role: sourceRoleSchema,
  content: z.string().min(1, '资料正文不能为空').max(2_000_000, '资料正文不能超过 2000000 字'),
})

/** 创建资料时可同时建立的人物或世界关联。 */
export const sourceCreationTargetSchema = z.object({
  targetType: z.enum(['persona', 'world'], { error: '关联目标类型无效' }),
  targetId: z.string().uuid('关联目标标识无效'),
})

/** 创建粘贴文本资料并建立初始关联的输入。 */
export const createSourceWithTargetsSchema = createSourceSchema.extend({
  targets: z.array(sourceCreationTargetSchema).default([]),
})

/** 文件资料 multipart 元数据校验。 */
export const importSourceFileMetadataSchema = z.object({
  name: z.string().trim().min(1, '资料名称不能为空').max(200, '资料名称不能超过 200 字'),
  role: sourceRoleSchema,
  targets: z.array(sourceCreationTargetSchema).default([]),
})

/** 修改资料元数据与正文的输入。 */
export const updateSourceSchema = createSourceSchema

/** 修改资料全局启用状态的输入。 */
export const updateSourceStatusSchema = z.object({
  isEnabled: z.boolean({ error: '资料状态必须是布尔值' }),
})

/** 批量修改资料全局启用状态的输入。 */
export const updateSourcesStatusSchema = updateSourceStatusSchema.extend({
  sourceIds: z.array(z.string().uuid('资料标识无效'))
    .min(1, '至少选择一项资料')
    .max(100, '一次最多修改 100 项资料'),
})

/** 资料列表服务端分页参数。 */
export const listSourcesPageSchema = z.object({
  page: z.coerce.number().int('页码必须是整数').min(1, '页码不能小于 1').default(1),
  pageSize: z.coerce.number().pipe(z.union([
    z.literal(5), z.literal(10), z.literal(20), z.literal(50), z.literal(100),
  ])).default(10),
})

/** 人物与世界管理列表共用的服务端分页参数。 */
export const listSubjectsPageSchema = listSourcesPageSchema

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
export type SubjectInitializationInput = z.infer<typeof subjectInitializationSchema>
export type GeneratePersonaDraftInput = z.infer<typeof generatePersonaDraftSchema>
export type PersonaDraft = z.infer<typeof personaDraftSchema>
export type UpdatePersonaInput = z.infer<typeof updatePersonaSchema>
export type UpdatePersonaStatusInput = z.infer<typeof updatePersonaStatusSchema>
export type UpdatePersonasStatusInput = z.infer<typeof updatePersonasStatusSchema>
export type CreatePersonaVersionInput = z.infer<typeof createPersonaVersionSchema>
export type CreateWorldInput = z.infer<typeof createWorldSchema>
export type GenerateWorldDraftInput = z.infer<typeof generateWorldDraftSchema>
export type WorldDraft = z.infer<typeof worldDraftSchema>
export type UpdateWorldInput = z.infer<typeof updateWorldSchema>
export type UpdateWorldStatusInput = z.infer<typeof updateWorldStatusSchema>
export type UpdateWorldsStatusInput = z.infer<typeof updateWorldsStatusSchema>
export type CreateWorldVersionInput = z.infer<typeof createWorldVersionSchema>
export type SaveSoulDraftInput = z.infer<typeof saveSoulDraftSchema>
export type CreateSoulDraftFromVersionInput = z.infer<typeof createSoulDraftFromVersionSchema>
export type CreateSourceInput = z.infer<typeof createSourceSchema>
export type SourceCreationTarget = z.infer<typeof sourceCreationTargetSchema>
export type CreateSourceWithTargetsInput = z.infer<typeof createSourceWithTargetsSchema>
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>
export type UpdateSourceStatusInput = z.infer<typeof updateSourceStatusSchema>
export type UpdateSourcesStatusInput = z.infer<typeof updateSourcesStatusSchema>
export type ListSourcesPageInput = z.infer<typeof listSourcesPageSchema>
export type ListSubjectsPageInput = z.infer<typeof listSubjectsPageSchema>
export type CreateSourceLinkInput = z.infer<typeof createSourceLinkSchema>
