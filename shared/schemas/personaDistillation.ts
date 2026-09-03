import { z } from 'zod'
import { PERSONA_DISTILLATION_STATUSES } from '../types/personaDistillation'
import { soulSnapshotSchema } from './content'

/** 人物蒸馏运行状态校验。 */
export const personaDistillationStatusSchema = z.enum(PERSONA_DISTILLATION_STATUSES, { error: '人物蒸馏状态无效' })

/** 创建人物蒸馏运行的共享输入。 */
export const createPersonaDistillationSchema = z.object({
  requestedName: z.string().trim().min(1, '候选人物名称不能为空').max(100, '候选人物名称不能超过 100 字'),
  objective: z.string().trim().min(1, '人物蒸馏目的不能为空').max(20_000, '人物蒸馏目的不能超过 20000 字'),
  worldId: z.string().uuid('世界标识无效').nullable().default(null),
  sourceIds: z.array(z.string().uuid('资料标识无效')).max(100, '一次最多选择 100 项资料').default([]),
})

/** 对已有人物重新执行蒸馏的共享输入。 */
export const restartPersonaDistillationSchema = z.object({
  objective: z.string().trim().min(1, '重新蒸馏目的不能为空').max(20_000, '重新蒸馏目的不能超过 20000 字'),
  sourceIds: z.array(z.string().uuid('资料标识无效')).max(100, '一次最多选择 100 项资料').default([]),
})

/** 保存人工编辑后的完整候选。 */
export const savePersonaDistillationCandidateSchema = z.object({
  expectedUpdatedAt: z.number().int('运行更新时间必须是整数').nonnegative('运行更新时间不能为负数'),
  promptText: soulSnapshotSchema.shape.promptText,
})

/** 确认已准备就绪人物候选的共享输入。 */
export const confirmPersonaDistillationCandidateSchema = z.object({
  expectedUpdatedAt: z.number().int('运行更新时间必须是整数').nonnegative('运行更新时间不能为负数'),
  name: z.string().trim().min(1, '人物名称不能为空').max(100, '人物名称不能超过 100 字'),
  expectedPromptHash: z.string().regex(/^[a-f0-9]{64}$/, '候选正文哈希必须是 SHA-256'),
})


export type CreatePersonaDistillationInput = z.infer<typeof createPersonaDistillationSchema>
export type RestartPersonaDistillationInput = z.infer<typeof restartPersonaDistillationSchema>
export type SavePersonaDistillationCandidateInput = z.infer<typeof savePersonaDistillationCandidateSchema>
export type ConfirmPersonaDistillationCandidateInput = z.infer<typeof confirmPersonaDistillationCandidateSchema>
