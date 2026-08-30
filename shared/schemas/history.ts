import { z } from 'zod'

/** 任务记录页支持的任务类型。 */
export const historyKindSchema = z.enum([
  'interest_assessment', 'artifact_generation', 'world_growth', 'persona_growth', 'persona_memory',
])

/** 任务记录页支持的统一状态。 */
export const historyStatusSchema = z.enum([
  'planning', 'awaiting_confirmation', 'queued', 'running', 'succeeded', 'partial', 'failed', 'canceled',
  'awaiting_review', 'completed',
])

/** 任务记录页服务端分页与筛选参数。 */
export const listHistoryPageSchema = z.object({
  page: z.coerce.number().int('页码必须是整数').min(1, '页码不能小于 1').default(1),
  pageSize: z.coerce.number().pipe(z.union([
    z.literal(5), z.literal(10), z.literal(20), z.literal(50), z.literal(100),
  ])).default(10),
  personaId: z.string().uuid('人物标识无效').optional(),
  kind: historyKindSchema.optional(),
  status: historyStatusSchema.optional(),
})

/** 任务记录页查询输入。 */
export type ListHistoryPageInput = z.infer<typeof listHistoryPageSchema>
/** 任务记录统一类型。 */
export type HistoryKind = z.infer<typeof historyKindSchema>
/** 任务记录统一状态。 */
export type HistoryStatus = z.infer<typeof historyStatusSchema>
