import { z } from 'zod'

/** AI 迭代分析模式。 */
export const analysisModeSchema = z.enum(['incremental', 'full_rebuild'], { error: '分析模式无效' })

/** 创建分析批次输入。 */
export const createAnalysisBatchSchema = z.object({
  mode: analysisModeSchema.default('incremental'),
})

/** 查询某对象最新分析批次的参数。 */
export const latestAnalysisBatchQuerySchema = z.object({
  analysisType: z.enum(['world_growth', 'persona_growth', 'persona_memory'], { error: '分析类型无效' }),
  subjectId: z.string().uuid('对象标识无效'),
})

/** 任务记录页查询分析批次的过滤条件。 */
export const listAnalysisBatchesQuerySchema = z.object({
  analysisType: z.enum(['world_growth', 'persona_growth', 'persona_memory'], { error: '分析类型无效' }).optional(),
  subjectId: z.string().uuid('对象标识无效').optional(),
  status: z.enum(['queued', 'running', 'awaiting_review', 'completed', 'failed'], { error: '分析状态无效' }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
})

/** AI 提议的新成长或记忆正文。 */
export const proposedLearningContentSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  scope: z.string().trim().min(1).max(500),
  importance: z.number().int().min(1).max(5),
  memoryType: z.enum(['interest', 'judgment', 'experience', 'preference']).optional(),
})

/** 文本模型返回的一项迭代建议。 */
export const modelIterationProposalSchema = z.object({
  operation: z.enum(['add', 'revise', 'merge', 'supersede', 'archive', 'no_change']),
  targetType: z.enum(['growth', 'memory']),
  targetIds: z.array(z.string().uuid()).max(50),
  proposed: proposedLearningContentSchema.nullable(),
  evidenceInputIds: z.array(z.string().uuid()).max(200),
  conflicts: z.array(z.string().trim().min(1).max(1_000)).max(20),
  rationale: z.string().trim().min(1).max(4_000),
})

/** 文本模型一次分析的完整结构。 */
export const modelIterationResultSchema = z.object({
  proposals: z.array(modelIterationProposalSchema).min(1).max(100),
  summary: z.string().trim().min(1).max(4_000),
})

/** 文本模型综合全部素材后返回的一份完整学习提示词草稿。 */
export const modelLearningPromptResultSchema = z.object({
  promptText: z.string().trim().min(1, '提炼后的提示词不能为空').max(20_000, '提炼后的提示词不能超过 20000 字'),
  summary: z.string().trim().min(1, '提炼摘要不能为空').max(4_000, '提炼摘要不能超过 4000 字'),
})

/** 成长算法提取阶段返回的一项带证据原子结论。 */
export const modelGrowthAtomicFactSchema = z.object({
  statement: z.string().trim().min(1).max(20_000),
  evidenceInputIds: z.array(z.string().uuid()).min(1).max(200),
  confidence: z.number().min(0).max(1),
})

/** 成长算法提取阶段的完整结构化输出。 */
export const modelGrowthExtractionResultSchema = z.object({
  facts: z.array(modelGrowthAtomicFactSchema).min(1).max(200),
})

/** 人物记忆候选证据的业务信号类型。 */
export const memoryEvidenceSignalSchema = z.enum([
  'external_record', 'user_feedback', 'user_decision', 'task_result', 'self_output',
])

/** 人物记忆算法提取阶段返回的一项证据引用。 */
export const modelMemoryEvidenceSchema = z.object({
  inputId: z.string().uuid(),
  signalType: memoryEvidenceSignalSchema,
})

/** 人物记忆算法提取阶段返回的一项原子候选。 */
export const modelMemoryAtomicFactSchema = z.object({
  statement: z.string().trim().min(1).max(20_000),
  memoryType: z.enum(['interest', 'judgment', 'experience', 'preference']),
  evidence: z.array(modelMemoryEvidenceSchema).min(1).max(200),
  confidence: z.number().min(0).max(1),
  conflicts: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
})

/** 人物记忆算法提取阶段的完整结构化输出。 */
export const modelMemoryExtractionResultSchema = z.object({
  facts: z.array(modelMemoryAtomicFactSchema).min(1).max(200),
})

/** 用户对一项提案的审核决定。 */
export const iterationProposalDecisionSchema = z.object({
  proposalId: z.string().uuid('提案标识无效'),
  action: z.enum(['accept', 'reject'], { error: '审核动作无效' }),
  reviewed: proposedLearningContentSchema.nullable().optional(),
  reason: z.string().trim().max(500, '审核说明不能超过 500 字').optional(),
})

/** 一次逐条或批量审核输入。 */
export const reviewIterationProposalsSchema = z.object({
  decisions: z.array(iterationProposalDecisionSchema).min(1, '至少审核一项提案').max(100, '一次最多审核 100 项提案'),
})

export type CreateAnalysisBatchInput = z.infer<typeof createAnalysisBatchSchema>
export type ListAnalysisBatchesInput = z.infer<typeof listAnalysisBatchesQuerySchema>
export type ModelIterationResult = z.infer<typeof modelIterationResultSchema>
export type ModelLearningPromptResult = z.infer<typeof modelLearningPromptResultSchema>
export type ModelGrowthExtractionResult = z.infer<typeof modelGrowthExtractionResultSchema>
export type ModelMemoryExtractionResult = z.infer<typeof modelMemoryExtractionResultSchema>
export type ReviewIterationProposalsInput = z.infer<typeof reviewIterationProposalsSchema>
