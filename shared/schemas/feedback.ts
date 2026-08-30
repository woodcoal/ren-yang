import { z } from 'zod'

/** 反馈确认后允许进入的四类业务目标。 */
export const feedbackTargetSchema = z.enum(['artifact', 'parameters', 'persona', 'source_fact'], {
  error: '反馈目标无效',
})

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

/** 用户确认或纠正分类，并提供目标动作所需的最少信息。 */
export const confirmFeedbackClassificationSchema = z.object({
  targetType: feedbackTargetSchema,
  blockId: z.string().uuid('产物块标识无效').nullable().optional(),
  sourceId: z.string().uuid('资料标识无效').nullable().optional(),
  hasEvidenceConflict: z.boolean().default(false),
})

export type FeedbackTarget = z.infer<typeof feedbackTargetSchema>
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>
export type FeedbackClassificationSuggestion = z.infer<typeof feedbackClassificationSuggestionSchema>
export type ConfirmFeedbackClassificationInput = z.infer<typeof confirmFeedbackClassificationSchema>
