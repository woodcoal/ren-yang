import { z } from 'zod'

/** 所有系统 AI 场景共同使用的供应商调用参数。 */
export const systemAiOperationParametersSchema = z.object({
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(64).max(8_192),
  timeoutMs: z.number().int().min(1_000).max(120_000),
})

/** 兴趣分析除通用调用参数外还控制检索的资料段落数。 */
export const interestAnalysisParametersSchema = systemAiOperationParametersSchema.extend({
  maxEvidenceChunks: z.number().int().min(0).max(50),
})

/** 系统内部四类 AI 操作的当前参数。 */
export const systemAiSettingsValuesSchema = z.object({
  interestAnalysis: interestAnalysisParametersSchema,
  contentAnalysis: systemAiOperationParametersSchema,
  draftGeneration: systemAiOperationParametersSchema,
  feedbackClassification: systemAiOperationParametersSchema,
})

/** 保存系统 AI 设置时必须提交四类完整参数，避免局部更新产生隐式继承。 */
export const updateSystemAiSettingsSchema = systemAiSettingsValuesSchema

export type SystemAiOperationParameters = z.infer<typeof systemAiOperationParametersSchema>
export type InterestAnalysisParameters = z.infer<typeof interestAnalysisParametersSchema>
export type SystemAiSettingsValues = z.infer<typeof systemAiSettingsValuesSchema>
export type UpdateSystemAiSettingsInput = z.infer<typeof updateSystemAiSettingsSchema>
