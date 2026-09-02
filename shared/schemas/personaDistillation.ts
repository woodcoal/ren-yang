import { z } from 'zod'
import {
  PERSONA_DISTILLATION_CLAIM_BASES,
  PERSONA_DISTILLATION_CLAIM_CATEGORIES,
  PERSONA_DISTILLATION_COVERAGE_DIMENSIONS,
  PERSONA_DISTILLATION_EVIDENCE_RELATIONS,
  PERSONA_DISTILLATION_MATERIAL_SOURCE_RELATIONS,
  PERSONA_DISTILLATION_SOURCE_RELATIONS,
  PERSONA_DISTILLATION_STATUSES,
} from '../types/personaDistillation'
import { soulSnapshotSchema } from './content'

/**
 * 判断字符串数组是否没有重复项。
 * @param values 已完成基础类型校验的字符串数组。
 * @returns 所有值唯一时为 true。
 */
function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

/** 人物蒸馏运行状态校验。 */
export const personaDistillationStatusSchema = z.enum(PERSONA_DISTILLATION_STATUSES, { error: '人物蒸馏状态无效' })

/** 人物蒸馏来源关系校验。 */
export const personaDistillationSourceRelationSchema = z.enum(PERSONA_DISTILLATION_SOURCE_RELATIONS, { error: '人物蒸馏来源关系无效' })

/** 已导入资料允许使用的来源关系校验，不包含独立的用户创建要求。 */
export const personaDistillationMaterialSourceRelationSchema = z.enum(PERSONA_DISTILLATION_MATERIAL_SOURCE_RELATIONS, { error: '人物蒸馏资料来源关系无效' })

/** 人物蒸馏资料覆盖维度校验。 */
export const personaDistillationCoverageDimensionSchema = z.enum(PERSONA_DISTILLATION_COVERAGE_DIMENSIONS, { error: '人物蒸馏覆盖维度无效' })

/** 人物蒸馏认知候选分类校验。 */
export const personaDistillationClaimCategorySchema = z.enum(PERSONA_DISTILLATION_CLAIM_CATEGORIES, { error: '人物蒸馏候选分类无效' })

/** 人物蒸馏认知候选依据类型校验。 */
export const personaDistillationClaimBasisSchema = z.enum(PERSONA_DISTILLATION_CLAIM_BASES, { error: '人物蒸馏候选依据无效' })

/** 人物蒸馏证据支持方向校验。 */
export const personaDistillationEvidenceRelationSchema = z.enum(PERSONA_DISTILLATION_EVIDENCE_RELATIONS, { error: '人物蒸馏证据关系无效' })

/** 创建人物蒸馏运行的共享输入。 */
export const createPersonaDistillationSchema = z.object({
  requestedName: z.string().trim().min(1, '候选人物名称不能为空').max(100, '候选人物名称不能超过 100 字'),
  objective: z.string().trim().min(1, '人物蒸馏目的不能为空').max(20_000, '人物蒸馏目的不能超过 20000 字'),
  worldId: z.string().uuid('世界标识无效').nullable().default(null),
  sourceIds: z.array(z.string().uuid('资料标识无效')).max(100, '一次最多选择 100 项资料').default([]),
})

/** 模型对一项蒸馏输入给出的来源和覆盖分类。 */
export const modelPersonaDistillationSourceAssessmentItemSchema = z.object({
  inputId: z.string().uuid(),
  sourceRelation: personaDistillationMaterialSourceRelationSchema,
  coverageDimensions: z.array(personaDistillationCoverageDimensionSchema)
    .max(PERSONA_DISTILLATION_COVERAGE_DIMENSIONS.length)
    .refine(hasUniqueValues, '人物蒸馏覆盖维度不能重复'),
  independentSourceKey: z.string().trim().min(1).max(500),
})

/** 模型完成资料覆盖评估时必须返回的完整结构。 */
export const modelPersonaDistillationSourceAssessmentSchema = z.object({
  sources: z.array(modelPersonaDistillationSourceAssessmentItemSchema).max(100)
    .refine(items => hasUniqueValues(items.map(item => item.inputId)), '人物蒸馏资料分类不能重复'),
})

/** 用户对一项运行级来源分类的纠正。 */
export const personaDistillationSourceCorrectionSchema = z.object({
  inputId: z.string().uuid('蒸馏输入标识无效'),
  sourceRelation: personaDistillationMaterialSourceRelationSchema.optional(),
  coverageDimensions: z.array(personaDistillationCoverageDimensionSchema)
    .max(PERSONA_DISTILLATION_COVERAGE_DIMENSIONS.length)
    .refine(hasUniqueValues, '人物蒸馏覆盖维度不能重复')
    .optional(),
}).refine(value => value.sourceRelation !== undefined || value.coverageDimensions !== undefined, {
  message: '至少纠正来源关系或覆盖维度',
})

/** 用户确认资料范围并启动认知提取的共享输入。 */
export const reviewPersonaDistillationSourcesSchema = z.object({
  expectedUpdatedAt: z.number().int('运行更新时间必须是整数').nonnegative('运行更新时间不能为负数'),
  acceptedInputIds: z.array(z.string().uuid('蒸馏输入标识无效')).max(100)
    .refine(hasUniqueValues, '接受的蒸馏输入不能重复'),
  corrections: z.array(personaDistillationSourceCorrectionSchema).max(100)
    .refine(items => hasUniqueValues(items.map(item => item.inputId)), '同一蒸馏输入不能重复纠正')
    .default([]),
})

/** 保存人工编辑候选并使旧评测失效的共享输入。 */
export const savePersonaDistillationCandidateSchema = z.object({
  expectedUpdatedAt: z.number().int('运行更新时间必须是整数').nonnegative('运行更新时间不能为负数'),
  promptText: soulSnapshotSchema.shape.promptText,
})

/** 确认已通过硬门禁评测的人物候选共享输入。 */
export const confirmPersonaDistillationCandidateSchema = z.object({
  expectedUpdatedAt: z.number().int('运行更新时间必须是整数').nonnegative('运行更新时间不能为负数'),
  name: z.string().trim().min(1, '人物名称不能为空').max(100, '人物名称不能超过 100 字'),
  expectedPromptHash: z.string().regex(/^[a-f0-9]{64}$/, '候选正文哈希必须是 SHA-256'),
})

/** 模型返回的一项人物蒸馏证据引用。 */
export const modelPersonaDistillationEvidenceSchema = z.object({
  inputId: z.string().uuid(),
  relation: personaDistillationEvidenceRelationSchema,
  quote: z.string().trim().min(1).max(20_000),
})

/** 模型返回的一项结构化人物认知候选。 */
export const modelPersonaDistillationClaimSchema = z.object({
  category: personaDistillationClaimCategorySchema,
  statement: z.string().trim().min(1).max(20_000),
  applicability: z.string().trim().min(1).max(4_000),
  limitations: z.string().trim().max(4_000),
  basis: personaDistillationClaimBasisSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(modelPersonaDistillationEvidenceSchema).min(1).max(200),
  conflicts: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
}).superRefine((claim, context) => {
  if (claim.basis === 'inferred' && !claim.limitations) {
    context.addIssue({ code: 'custom', path: ['limitations'], message: '推断型候选必须说明局限' })
  }
})

/** 模型提取人物认知候选时必须返回的完整结构。 */
export const modelPersonaDistillationExtractionSchema = z.object({
  claims: z.array(modelPersonaDistillationClaimSchema).max(200),
})

export type CreatePersonaDistillationInput = z.infer<typeof createPersonaDistillationSchema>
export type ModelPersonaDistillationSourceAssessment = z.infer<typeof modelPersonaDistillationSourceAssessmentSchema>
export type ReviewPersonaDistillationSourcesInput = z.infer<typeof reviewPersonaDistillationSourcesSchema>
export type SavePersonaDistillationCandidateInput = z.infer<typeof savePersonaDistillationCandidateSchema>
export type ConfirmPersonaDistillationCandidateInput = z.infer<typeof confirmPersonaDistillationCandidateSchema>
export type ModelPersonaDistillationClaim = z.infer<typeof modelPersonaDistillationClaimSchema>
export type ModelPersonaDistillationExtraction = z.infer<typeof modelPersonaDistillationExtractionSchema>
