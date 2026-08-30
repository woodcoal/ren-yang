import { z } from 'zod'

/** 成长当前统一参加全部新任务；数据库字段保留用于兼容既有修订。 */
export const DEFAULT_GROWTH_SCOPE = '所有新任务'

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
  importance: z.number().int('重要程度必须是整数').min(1, '重要程度不能低于 1').max(5, '重要程度不能高于 5'),
  sourceIds: z.array(z.string().uuid('来源标识无效')).max(100, '一次最多引用 100 项来源').default([]),
})

/** 修改成长当前修订输入；来源证据由上一版不可变继承。 */
export const updateGrowthSchema = createGrowthSchema.omit({ sourceIds: true })

/** 单份资料导入成长时的来源与人工评分。 */
export const importGrowthSourceItemSchema = z.object({
  sourceId: z.string().uuid('来源标识无效'),
  importance: z.number().int('资料评分必须是整数').min(1, '资料评分不能低于 1').max(5, '资料评分不能高于 5'),
})

/** 将多份原始资料分别导入为成长候选。 */
export const importGrowthSourcesSchema = z.object({
  items: z.array(importGrowthSourceItemSchema).min(1, '至少选择一份资料').max(100, '一次最多导入 100 份资料'),
}).superRefine((value, context) => {
  if (new Set(value.items.map(item => item.sourceId)).size !== value.items.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: '同一份资料不能重复导入' })
  }
})

/** 批量永久删除成长输入。 */
export const deleteGrowthSchema = z.object({
  ids: z.array(z.string().uuid('成长标识无效')).min(1, '至少选择一项成长').max(100, '一次最多删除 100 项成长'),
})

export type BatchEnabledStateInput = z.infer<typeof batchEnabledStateSchema>
export type BatchLearningStatusInput = z.infer<typeof batchLearningStatusSchema>
export type CreatePersonaFeedbackSourceInput = z.infer<typeof createPersonaFeedbackSourceSchema>
export type DeletePersonaFeedbackSourcesInput = z.infer<typeof deletePersonaFeedbackSourcesSchema>
export type CreateGrowthInput = z.infer<typeof createGrowthSchema>
export type UpdateGrowthInput = z.infer<typeof updateGrowthSchema>
export type ImportGrowthSourcesInput = z.infer<typeof importGrowthSourcesSchema>
export type DeleteGrowthInput = z.infer<typeof deleteGrowthSchema>
