import { z } from 'zod'

/** 迁移前系统 AI 设置行中的供应商调用参数。 */
const legacySystemAiOperationParametersSchema = z.object({
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(64).max(8_192),
  timeoutMs: z.number().int().min(1_000).max(120_000),
})

/** 只供历史运行解析迁移前默认模型设置，不再作为公开设置契约。 */
export const systemAiSettingsValuesSchema = z.object({
  textModelDeploymentId: z.union([z.literal(''), z.string().uuid('默认文本模型标识无效')]).default(''),
  imageModelDeploymentId: z.union([z.literal(''), z.string().uuid('默认图片模型标识无效')]).default(''),
  draftGeneration: legacySystemAiOperationParametersSchema,
  feedbackClassification: legacySystemAiOperationParametersSchema,
})
