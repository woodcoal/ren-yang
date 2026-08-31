import { z } from 'zod'

/** 灵魂整理算法的测试输入。 */
export const soulAlgorithmTestInputSchema = z.object({
  soulText: z.string().trim().min(1, '灵魂原文不能为空').max(50_000, '灵魂原文不能超过 50000 字'),
}).strict()

/** 成长提炼算法第一步的业务化测试输入。 */
export const growthExtractAlgorithmTestInputSchema = z.object({
  stepKey: z.literal('extract'),
  baselineText: z.string().trim().max(20_000, '当前成长基线不能超过 20000 字'),
  materialText: z.string().trim().min(1, '成长资料不能为空').max(100_000, '成长资料不能超过 100000 字'),
}).strict()

/** 成长提炼算法第二步接收的第一步延续数据。 */
export const growthSynthesizeAlgorithmTestInputSchema = z.object({
  stepKey: z.literal('synthesize'),
  configurationVersion: z.number().int().positive('算法配置版本无效'),
  baselineJson: z.string().max(100_000, '成长基线数据过长'),
  factsJson: z.string().max(500_000, '原子结论数据过长'),
}).strict()

/** 固定算法测试允许提交的业务化输入。 */
export const aiAlgorithmTestInputSchema = z.union([
  soulAlgorithmTestInputSchema,
  growthExtractAlgorithmTestInputSchema,
  growthSynthesizeAlgorithmTestInputSchema,
])

export type SoulAlgorithmTestInput = z.infer<typeof soulAlgorithmTestInputSchema>
export type GrowthExtractAlgorithmTestInput = z.infer<typeof growthExtractAlgorithmTestInputSchema>
export type GrowthSynthesizeAlgorithmTestInput = z.infer<typeof growthSynthesizeAlgorithmTestInputSchema>
export type AiAlgorithmTestInput = z.infer<typeof aiAlgorithmTestInputSchema>
