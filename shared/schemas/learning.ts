import { z } from 'zod'

/** 批量启用或禁用原始资料和处理记录。 */
export const batchEnabledStateSchema = z.object({
  ids: z.array(z.string().uuid('条目标识无效')).min(1, '至少选择一项').max(200, '一次最多处理 200 项'),
  isEnabled: z.boolean(),
})

/** 成长与记忆允许由管理员执行的目标状态。 */
export const reviewLearningStatusSchema = z.enum(['active', 'archived', 'rejected'], { error: '目标状态无效' })

/** 成长或记忆批量审核输入。 */
export const batchLearningStatusSchema = z.object({
  ids: z.array(z.string().uuid('条目标识无效')).min(1, '至少选择一项').max(200, '一次最多处理 200 项'),
  status: reviewLearningStatusSchema,
  reason: z.string().trim().max(500, '操作说明不能超过 500 字').optional(),
})

/** 创建人物反馈资料输入。 */
export const createPersonaFeedbackSourceSchema = z.object({
  title: z.string().trim().min(1, '反馈标题不能为空').max(200, '反馈标题不能超过 200 字'),
  content: z.string().trim().min(1, '反馈内容不能为空').max(200_000, '反馈内容不能超过 200000 字'),
  sourceType: z.enum(['run_feedback', 'manual', 'imported']).default('manual'),
  sourceId: z.string().uuid('来源标识无效').nullable().optional(),
})

/** 批量删除人物反馈资料输入。 */
export const deletePersonaFeedbackSourcesSchema = z.object({
  ids: z.array(z.string().uuid('反馈资料标识无效')).min(1, '至少选择一项').max(100, '一次最多删除 100 项'),
})

/** 人工创建成长候选输入。 */
export const createGrowthSchema = z.object({
  content: z.string().trim().min(1, '成长内容不能为空').max(20_000, '成长内容不能超过 20000 字'),
  scope: z.string().trim().min(1, '适用范围不能为空').max(500, '适用范围不能超过 500 字'),
  importance: z.number().int('重要程度必须是整数').min(1, '重要程度不能低于 1').max(5, '重要程度不能高于 5'),
  sourceIds: z.array(z.string().uuid('来源标识无效')).max(100, '一次最多引用 100 项来源').default([]),
})

export type BatchEnabledStateInput = z.infer<typeof batchEnabledStateSchema>
export type BatchLearningStatusInput = z.infer<typeof batchLearningStatusSchema>
export type CreatePersonaFeedbackSourceInput = z.infer<typeof createPersonaFeedbackSourceSchema>
export type DeletePersonaFeedbackSourcesInput = z.infer<typeof deletePersonaFeedbackSourcesSchema>
export type CreateGrowthInput = z.infer<typeof createGrowthSchema>
