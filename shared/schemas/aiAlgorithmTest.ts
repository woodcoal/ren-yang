import { z } from 'zod'

/** 灵魂整理算法的测试输入。 */
export const soulAlgorithmTestInputSchema = z.object({
  soulText: z.string().trim().min(1, '灵魂原文不能为空').max(50_000, '灵魂原文不能超过 50000 字'),
}).strict()

/** 成长提炼算法的测试输入。 */
export const growthAlgorithmTestInputSchema = z.object({
  baselineText: z.string().trim().max(20_000, '当前成长基线不能超过 20000 字'),
  materialText: z.string().trim().min(1, '成长资料不能为空').max(100_000, '成长资料不能超过 100000 字'),
}).strict()

/** 固定算法测试允许提交的业务化输入。 */
export const aiAlgorithmTestInputSchema = z.union([
  soulAlgorithmTestInputSchema,
  growthAlgorithmTestInputSchema,
])

export type SoulAlgorithmTestInput = z.infer<typeof soulAlgorithmTestInputSchema>
export type GrowthAlgorithmTestInput = z.infer<typeof growthAlgorithmTestInputSchema>
export type AiAlgorithmTestInput = z.infer<typeof aiAlgorithmTestInputSchema>
