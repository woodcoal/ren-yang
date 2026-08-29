import { z } from 'zod'

/** 当前可主动检测的外部上下文提供器。 */
export const checkContextProviderSchema = z.object({
  provider: z.literal('openviking'),
})
/** 重建请求必须明确目标提供器，避免误删其他索引。 */
export const reindexContextSchema = z.object({
  provider: z.literal('openviking'),
  confirmed: z.literal(true, { error: '重建索引前必须明确确认' }),
})
