import { z } from 'zod'

/** 反馈确认后允许进入的四类业务目标。 */
export const feedbackTargetSchema = z.enum(['artifact', 'parameters', 'persona', 'source_fact'], {
  error: '反馈目标无效',
})

/** 人物记忆人工审核输入。 */
export const updatePersonaMemoryStatusSchema = z.object({
  memoryId: z.string().trim().min(1, '记忆标识不能为空').max(2_000, '记忆标识过长'),
  status: z.enum(['active', 'deprecated', 'rejected']),
})

/** 人物记忆人工审核输入类型。 */
export type UpdatePersonaMemoryStatusInput = z.infer<typeof updatePersonaMemoryStatusSchema>

/** 用户可以评价一次运行或其中一个具体产物块。 */
export const submitFeedbackSchema = z.object({
  content: z.string().trim().min(1, '反馈内容不能为空').max(10_000, '反馈内容不能超过 10000 字'),
  blockId: z.string().uuid('产物块标识无效').nullable().optional(),
  rating: z.enum(['positive', 'negative', 'neutral']).nullable().optional(),
  isLongTerm: z.boolean().default(false),
  editedOutput: z.string().max(50_000, '直接编辑结果不能超过 50000 字').nullable().optional(),
})

/** 文本模型给出的可纠正反馈分类建议。 */
export const feedbackClassificationSuggestionSchema = z.object({
  targetType: feedbackTargetSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(2_000),
})

/** 人物快照中允许通过修订提案修改的字段。 */
export const personaRevisionFieldSchema = z.enum([
  'summary',
  'identityFacts',
  'interests',
  'valuesAndMotivations',
  'expressionStyle',
  'appearance',
  'visualStyle',
  'constraints',
])

/** 用户确认的字段级人物补丁。 */
export const personaRevisionPatchSchema = z.object({
  field: personaRevisionFieldSchema,
  after: z.string().trim().max(20_000, '修订后的字段不能超过 20000 字'),
  reason: z.string().trim().min(1, '修订理由不能为空').max(2_000),
})

/** 用户确认或纠正分类，并提供目标动作所需的最少信息。 */
export const confirmFeedbackClassificationSchema = z.object({
  targetType: feedbackTargetSchema,
  blockId: z.string().uuid('产物块标识无效').nullable().optional(),
  personaPatches: z.array(personaRevisionPatchSchema).max(8).default([]),
  sourceId: z.string().uuid('资料标识无效').nullable().optional(),
  hasEvidenceConflict: z.boolean().default(false),
})

/** 修订提案列表的可选筛选。 */
export const listRevisionProposalsQuerySchema = z.object({
  personaId: z.string().uuid('人物标识无效').optional(),
  status: z.enum(['awaiting_evaluation', 'evaluation_failed', 'ready', 'published', 'rejected']).optional(),
})

/** 评测用例的固定分类。 */
export const evaluationCaseCategorySchema = z.enum(['behavior', 'style', 'safety'])

/** 创建不可变人物评测用例。 */
export const createEvaluationCaseSchema = z.object({
  name: z.string().trim().min(1, '评测用例名称不能为空').max(200),
  category: evaluationCaseCategorySchema,
  prompt: z.string().trim().min(1, '评测输入不能为空').max(10_000),
  expectedChange: z.enum(['improve', 'retain']),
  requiredTerms: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  forbiddenTerms: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  minimumScore: z.number().min(0).max(1).default(0.7),
  maxRegression: z.number().min(0).max(1).default(0.1),
})

/** 固定评测模型必须返回的候选与基础版本比较证据。 */
export const evaluationModelOutputSchema = z.object({
  baseOutput: z.string().trim().min(1).max(50_000),
  candidateOutput: z.string().trim().min(1).max(50_000),
  baseScore: z.number().min(0).max(1),
  candidateScore: z.number().min(0).max(1),
  reasoningSummary: z.string().trim().min(1).max(4_000),
})

/** 人工发布必须包含显式确认。 */
export const publishRevisionProposalSchema = z.object({
  confirmed: z.literal(true, { error: '发布人物版本前必须明确确认' }),
})

/** 拒绝提案时保存的明确原因。 */
export const rejectRevisionProposalSchema = z.object({
  reason: z.string().trim().min(1, '拒绝原因不能为空').max(2_000),
})

export type FeedbackTarget = z.infer<typeof feedbackTargetSchema>
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>
export type FeedbackClassificationSuggestion = z.infer<typeof feedbackClassificationSuggestionSchema>
export type PersonaRevisionPatchInput = z.infer<typeof personaRevisionPatchSchema>
export type ConfirmFeedbackClassificationInput = z.infer<typeof confirmFeedbackClassificationSchema>
export type CreateEvaluationCaseInput = z.infer<typeof createEvaluationCaseSchema>
export type EvaluationModelOutput = z.infer<typeof evaluationModelOutputSchema>
