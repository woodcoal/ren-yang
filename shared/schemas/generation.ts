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
})

/** 创建不可变参数方案版本。 */
export const createParameterProfileSchema = z.object({
  name: z.string().trim().min(1, '参数方案名称不能为空').max(100),
  values: textModelParametersSchema,
})

/** 纯文字格式模板规格。 */
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
  parameterProfileId: z.string().uuid('参数方案标识无效').nullable().optional(),
})

/** 文档规划运行输入。 */
export const createGenerationRunSchema = z.object({
  personaId: z.string().uuid('人物标识无效'),
  requirement: z.string().trim().min(1, '创作要求不能为空').max(50_000),
  scene: sceneContextSchema.optional(),
  parameterProfileId: z.string().uuid('参数方案标识无效').nullable().optional(),
  formatTemplateId: z.string().uuid('格式模板标识无效').nullable().optional(),
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

/** 文档规格中的纯文字块。 */
export const documentSpecBlockSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, '块键必须是小写字母开头的安全标识'),
  role: z.enum(['heading', 'paragraph', 'list', 'quote']),
  instruction: z.string().trim().min(1).max(5_000),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).min(1).max(10),
  dependsOn: z.array(z.string()).max(20),
})

/** AI 规划及用户编辑共用的文档规格。 */
export const documentSpecSchema = z.object({
  title: z.string().trim().min(1, '文档标题不能为空').max(500),
  summary: z.string().trim().min(1, '文档摘要不能为空').max(2_000),
  blocks: z.array(documentSpecBlockSchema).min(1).max(20),
}).superRefine((value, context) => {
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
export type CreateGenerationRunInput = z.infer<typeof createGenerationRunSchema>
export type InterestAssessment = z.infer<typeof interestAssessmentSchema>
export type DocumentSpec = z.infer<typeof documentSpecSchema>
