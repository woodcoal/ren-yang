import { z } from 'zod'

/** 所有系统 AI 场景共同使用的供应商调用参数。 */
export const systemAiOperationParametersSchema = z.object({
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(64).max(8_192),
  timeoutMs: z.number().int().min(1_000).max(120_000),
})

/** 系统内部仍由默认文本模型执行的两类 AI 操作参数。 */
export const systemAiSettingsValuesSchema = z.object({
  textModelDeploymentId: z.union([z.literal(''), z.string().uuid('默认文本模型标识无效')]).default(''),
  imageModelDeploymentId: z.union([z.literal(''), z.string().uuid('默认图片模型标识无效')]).default(''),
  draftGeneration: systemAiOperationParametersSchema,
  feedbackClassification: systemAiOperationParametersSchema,
})

/** 保存系统 AI 设置时必须提交三类完整参数，避免局部更新产生隐式继承。 */
export const updateSystemAiSettingsSchema = systemAiSettingsValuesSchema

export type SystemAiOperationParameters = z.infer<typeof systemAiOperationParametersSchema>
export type SystemAiSettingsValues = z.infer<typeof systemAiSettingsValuesSchema>
export type UpdateSystemAiSettingsInput = z.infer<typeof updateSystemAiSettingsSchema>
