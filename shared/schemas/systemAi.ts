import { z } from 'zod'

/** 全站未显式绑定模型时使用的默认文本与图片部署。 */
export const systemAiSettingsValuesSchema = z.object({
  textModelDeploymentId: z.union([z.literal(''), z.string().uuid('默认文本模型标识无效')]).default(''),
  imageModelDeploymentId: z.union([z.literal(''), z.string().uuid('默认图片模型标识无效')]).default(''),
})

/** 保存默认模型时完整替换两个部署选择，避免局部继承。 */
export const updateSystemAiSettingsSchema = systemAiSettingsValuesSchema

export type SystemAiSettingsValues = z.infer<typeof systemAiSettingsValuesSchema>
export type UpdateSystemAiSettingsInput = z.infer<typeof updateSystemAiSettingsSchema>
