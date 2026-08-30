import { z } from 'zod'

/** AI 提示词稳定编码，只允许分段英文标识。 */
export const aiPromptCodeSchema = z.string().trim().regex(
  /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/,
  '提示词编码无效',
)

/** 保存 AI 提示词草稿的完整模板。 */
export const saveAiPromptDraftSchema = z.object({
  baseVersionId: z.string().uuid('基础版本标识无效').nullable(),
  systemPromptTemplate: z.string().max(100_000, '系统提示模板不能超过 100000 字').nullable(),
  userPromptTemplate: z.string().trim().min(1, '用户提示模板不能为空').max(200_000, '用户提示模板不能超过 200000 字'),
  changeSummary: z.string().trim().min(1, '请填写修改说明').max(500, '修改说明不能超过 500 字'),
})

/** 发布 AI 提示词草稿时的并发保护参数。 */
export const publishAiPromptDraftSchema = z.object({
  expectedDraftUpdatedAt: z.number().int().nonnegative('草稿更新时间无效'),
})

export type SaveAiPromptDraftInput = z.infer<typeof saveAiPromptDraftSchema>
export type PublishAiPromptDraftInput = z.infer<typeof publishAiPromptDraftSchema>
