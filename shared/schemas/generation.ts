import { z } from 'zod'

/** 单次运行可选、且绝不写回人物版本的场景快照。 */
export const sceneContextSchema = z.object({
  ageStage: z.string().trim().max(100).default(''),
  location: z.string().trim().max(500).default(''),
  currentGoal: z.string().trim().max(1_000).default(''),
  emotion: z.string().trim().max(500).default(''),
  event: z.string().trim().max(2_000).default(''),
})

/** 运行最终解析后的文本模型参数。 */
export const textModelParametersSchema = z.object({
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(64).max(8_192),
  timeoutMs: z.number().int().min(1_000).max(120_000),
  maxEvidenceChunks: z.number().int().min(0).max(50),
  maxTextBlocks: z.number().int().min(1).max(20),
  maxImageBlocks: z.number().int().min(0).max(20).default(4),
  maxPromptCharacters: z.number().int().min(1_000).max(500_000).default(120_000),
  maxTotalTokens: z.number().int().min(64).max(1_000_000).default(50_000),
  maxBlockAttempts: z.number().int().min(1).max(10).default(2),
  contextWindowTokens: z.number().int().min(4_096).max(2_000_000).default(32_768),
  reservedOutputTokens: z.number().int().min(64).max(200_000).default(8_192),
  safetyMarginTokens: z.number().int().min(0).max(200_000).default(2_048),
  worldBudgetTokens: z.number().int().min(0).max(500_000).default(5_000),
  worldSoulBudgetTokens: z.number().int().min(0).max(200_000).default(2_500),
  worldGrowthBudgetTokens: z.number().int().min(0).max(200_000).default(2_500),
  personaBudgetTokens: z.number().int().min(0).max(500_000).default(9_000),
  personaSoulBudgetTokens: z.number().int().min(1).max(200_000).default(3_500),
  personaGrowthBudgetTokens: z.number().int().min(0).max(200_000).default(2_500),
  personaMemoryBudgetTokens: z.number().int().min(0).max(200_000).default(3_000),
  sourceBudgetTokens: z.number().int().min(0).max(500_000).default(5_000),
}).superRefine((value, context) => {
  const availableInputTokens = value.contextWindowTokens - value.reservedOutputTokens - value.safetyMarginTokens
  if (availableInputTokens <= 0) {
    context.addIssue({ code: 'custom', path: ['contextWindowTokens'], message: '模型上下文必须大于预留输出与安全余量之和' })
  }
  if (value.maxOutputTokens > value.reservedOutputTokens) {
    context.addIssue({ code: 'custom', path: ['reservedOutputTokens'], message: '预留输出 Token 不能小于单次回答长度上限' })
  }
  if (value.worldSoulBudgetTokens + value.worldGrowthBudgetTokens > value.worldBudgetTokens) {
    context.addIssue({ code: 'custom', path: ['worldBudgetTokens'], message: '世界灵魂与世界成长预算之和不能超过世界总预算' })
  }
  if (value.personaSoulBudgetTokens + value.personaGrowthBudgetTokens + value.personaMemoryBudgetTokens > value.personaBudgetTokens) {
    context.addIssue({ code: 'custom', path: ['personaBudgetTokens'], message: '人物灵魂、人物成长与人物记忆预算之和不能超过人物总预算' })
  }
  if (value.worldBudgetTokens + value.personaBudgetTokens + value.sourceBudgetTokens > availableInputTokens) {
    context.addIssue({ code: 'custom', path: ['sourceBudgetTokens'], message: '世界、人物和参考资料总预算不能超过可用输入 Token' })
  }
})

/** 创建不可变参数方案版本。 */
export const createParameterProfileSchema = z.object({
  name: z.string().trim().min(1, '参数方案名称不能为空').max(100),
  values: textModelParametersSchema,
})

/** 文档格式模板规格。 */
export const formatTemplateSpecSchema = z.object({
  guidance: z.string().trim().min(1, '格式指导不能为空').max(10_000),
  minimumBlocks: z.number().int().min(1).max(20),
  maximumBlocks: z.number().int().min(1).max(20),
}).superRefine((value, context) => {
  if (value.minimumBlocks > value.maximumBlocks) {
    context.addIssue({ code: 'custom', path: ['maximumBlocks'], message: '最大块数不能小于最小块数' })
  }
})

/** 创建不可变格式模板版本。 */
export const createFormatTemplateSchema = z.object({
  name: z.string().trim().min(1, '模板名称不能为空').max(100),
  spec: formatTemplateSpecSchema,
})

/** 兴趣判断运行输入。 */
export const createInterestRunSchema = z.object({
  personaId: z.string().uuid('人物标识无效'),
  content: z.string().trim().min(1, '待判断内容不能为空').max(50_000),
  scene: sceneContextSchema.optional(),
})

/** 文档规划运行输入。 */
export const createGenerationRunSchema = z.object({
  personaId: z.string().uuid('人物标识无效'),
  requirement: z.string().trim().min(1, '创作要求不能为空').max(50_000),
  scene: sceneContextSchema.optional(),
  parameterProfileId: z.string().uuid('参数方案标识无效').nullable().optional(),
  formatTemplateId: z.string().uuid('格式模板标识无效').nullable().optional(),
  includeImages: z.boolean().default(false),
})

/** 兴趣判断分项因素。 */
export const interestFactorSchema = z.object({
  dimension: z.enum(['topic', 'value', 'utility', 'novelty', 'format']),
  score: z.number().min(-1).max(1),
  explanation: z.string().trim().min(1).max(1_000),
})

/** 文本模型必须返回的兴趣判断结构。 */
export const interestAssessmentSchema = z.object({
  probability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  decision: z.enum(['interested', 'not_interested', 'insufficient_information']),
  factors: z.array(interestFactorSchema).min(1).max(10),
  supportingEvidenceIds: z.array(z.string().uuid()).max(50),
  opposingEvidenceIds: z.array(z.string().uuid()).max(50),
  unknowns: z.array(z.string().trim().min(1).max(1_000)).max(20),
  reasoningSummary: z.string().trim().min(1).max(4_000),
})

/** 图片模型使用且会写入尝试快照的完整视觉简报。 */
export const imageVisualBriefSchema = z.object({
  theme: z.string().trim().min(1, '图片主题不能为空').max(2_000),
  subject: z.string().trim().min(1, '图片主体不能为空').max(2_000),
  composition: z.string().trim().min(1, '构图要求不能为空').max(2_000),
  colorPalette: z.string().trim().min(1, '色彩要求不能为空').max(1_000),
  texture: z.string().trim().min(1, '质感要求不能为空').max(1_000),
  aspectRatio: z.enum(['1:1', '4:3', '3:4', '16:9', '9:16']),
  altText: z.string().trim().min(1, '替代文本不能为空').max(500),
  negativePrompt: z.string().trim().max(2_000).default(''),
})

/** 文档规格中的纯文字块。 */
export const textDocumentSpecBlockSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, '块键必须是小写字母开头的安全标识'),
  type: z.literal('text').default('text'),
  role: z.enum(['heading', 'paragraph', 'list', 'quote']),
  instruction: z.string().trim().min(1).max(5_000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).min(1).max(10),
  dependsOn: z.array(z.string()).max(20),
})

/** 文档规格中的图片块。 */
export const imageDocumentSpecBlockSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, '块键必须是小写字母开头的安全标识'),
  type: z.literal('image'),
  role: z.enum(['hero_image', 'illustration']),
  instruction: z.string().trim().min(1).max(5_000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).min(1).max(10),
  dependsOn: z.array(z.string()).max(20),
  visualBrief: imageVisualBriefSchema,
})

/** 兼容阶段三无 type 文字块的统一块规格。 */
export const documentSpecBlockSchema = z.union([imageDocumentSpecBlockSchema, textDocumentSpecBlockSchema])

/** 用户可以从同一产物选择的导出格式。 */
export const artifactFormatSchema = z.enum(['html', 'markdown', 'txt'])

/** AI 规划及用户编辑共用的文档规格。 */
export const documentSpecSchema = z.object({
  title: z.string().trim().min(1, '文档标题不能为空').max(500),
  summary: z.string().trim().min(1, '文档摘要不能为空').max(2_000),
  purpose: z.string().trim().max(2_000).default(''),
  constraints: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
  requestedFormats: z.array(artifactFormatSchema).min(1).max(3).default(['html', 'markdown', 'txt']),
  blocks: z.array(documentSpecBlockSchema).min(1).max(20),
}).superRefine((value, context) => {
  if (new Set(value.requestedFormats).size !== value.requestedFormats.length) {
    context.addIssue({ code: 'custom', path: ['requestedFormats'], message: '导出格式不能重复' })
  }
  const keys = new Set<string>()
  value.blocks.forEach((block, index) => {
    if (keys.has(block.key)) {
      context.addIssue({ code: 'custom', path: ['blocks', index, 'key'], message: '块键不能重复' })
    }
    keys.add(block.key)
  })
  value.blocks.forEach((block, index) => {
    for (const dependency of block.dependsOn) {
      const dependencyIndex = value.blocks.findIndex(candidate => candidate.key === dependency)
      if (dependencyIndex < 0) {
        context.addIssue({ code: 'custom', path: ['blocks', index, 'dependsOn'], message: `依赖块 ${dependency} 不存在` })
      }
      else if (dependencyIndex >= index) {
        context.addIssue({ code: 'custom', path: ['blocks', index, 'dependsOn'], message: '块只能依赖排在其前面的块' })
      }
    }
  })
})

/** 单个文字块模型调用的纯文本结构。 */
export const textBlockOutputSchema = z.object({
  text: z.string().trim().min(1, '文字块输出不能为空').max(50_000),
})

/** 修改待确认文档规格。 */
export const updateDocumentSpecSchema = documentSpecSchema

/** 选择块的一次成功尝试。 */
export const selectBlockAttemptSchema = z.object({
  attemptId: z.string().uuid('尝试标识无效'),
})

/** 设置块锁定状态。 */
export const setBlockLockSchema = z.object({
  locked: z.boolean(),
})

/** 请求即时渲染一种或多种格式。 */
export const renderArtifactSchema = z.object({
  formats: z.array(artifactFormatSchema).min(1).max(3),
}).superRefine((value, context) => {
  if (new Set(value.formats).size !== value.formats.length) {
    context.addIssue({ code: 'custom', path: ['formats'], message: '渲染格式不能重复' })
  }
})

/** 运行列表查询。 */
export const listRunsQuerySchema = z.object({
  personaId: z.string().uuid().optional(),
  kind: z.enum(['interest_assessment', 'artifact_generation']).optional(),
  status: z.enum(['planning', 'awaiting_confirmation', 'queued', 'running', 'succeeded', 'partial', 'failed', 'canceled']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export type SceneContext = z.infer<typeof sceneContextSchema>
export type TextModelParameters = z.infer<typeof textModelParametersSchema>
export type CreateParameterProfileInput = z.infer<typeof createParameterProfileSchema>
export type CreateFormatTemplateInput = z.infer<typeof createFormatTemplateSchema>
export type CreateInterestRunInput = z.infer<typeof createInterestRunSchema>
export type CreateGenerationRunInput = z.input<typeof createGenerationRunSchema>
export type InterestAssessment = z.infer<typeof interestAssessmentSchema>
export type DocumentSpec = z.infer<typeof documentSpecSchema>
export type ImageVisualBrief = z.infer<typeof imageVisualBriefSchema>
export type ArtifactFormat = z.infer<typeof artifactFormatSchema>
