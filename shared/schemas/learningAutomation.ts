import { z } from 'zod'

/** 后台统一学习自动化周期设置。 */
export const updateLearningAutomationSettingsSchema = z.object({
  intervalHours: z.number().int('执行周期必须是整数').min(1, '执行周期不能少于 1 小时').max(720, '执行周期不能超过 720 小时'),
})

export type UpdateLearningAutomationSettingsInput = z.infer<typeof updateLearningAutomationSettingsSchema>
