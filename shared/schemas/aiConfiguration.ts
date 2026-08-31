import { z } from 'zod'

/** 当前平台支持的 AI 接口协议。 */
export const aiConnectionProtocolSchema = z.enum(['openai_compatible'], { error: 'AI 接口协议无效' })

/** 不允许在地址中夹带认证信息、查询密钥或片段的 AI 接口地址。 */
const aiEndpointSchema = z.url('接口地址无效').max(2_000).superRefine((value, context) => {
  const endpoint = new URL(value)
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    context.addIssue({ code: 'custom', message: '接口地址不能包含账号、密码、查询参数或片段' })
  }
})

/** AI 模型部署的输出形态。 */
export const aiModelModalitySchema = z.enum(['text', 'image'], { error: '模型类型无效' })

/** 首批代码固定流程的算法编码。 */
export const aiAlgorithmCodeSchema = z.enum(['persona_soul', 'world_soul', 'persona_growth', 'world_growth', 'persona_memory'], { error: '算法编码无效' })

/** 允许作为 HTTP User-Agent 请求头发送的可见 ASCII 文本。 */
export const aiUserAgentSchema = z.string().trim().max(500, 'UserAgent 不能超过 500 个字符')
  .regex(/^[\x20-\x7E]*$/, 'UserAgent 只能包含可见 ASCII 字符')

/** 新建 AI 接口连接时提交的完整参数。 */
export const createAiConnectionSchema = z.object({
  name: z.string().trim().min(1, '接口名称不能为空').max(100),
  protocol: aiConnectionProtocolSchema.default('openai_compatible'),
  endpoint: aiEndpointSchema,
  userAgent: aiUserAgentSchema.default(''),
  apiKey: z.string().trim().min(1, 'API Key 不能为空').max(8_000),
  isEnabled: z.boolean().default(true),
})

/** 编辑 AI 接口连接时提交的完整非敏感参数；省略密钥表示保留原值。 */
export const updateAiConnectionSchema = createAiConnectionSchema.omit({ apiKey: true, userAgent: true }).extend({
  userAgent: aiUserAgentSchema.optional(),
  apiKey: z.string().trim().min(1, 'API Key 不能为空').max(8_000).optional(),
})

/** 新建或编辑具体模型部署时提交的完整参数。 */
export const saveAiModelDeploymentSchema = z.object({
  connectionId: z.string().uuid('接口连接标识无效'),
  name: z.string().trim().min(1, '模型名称不能为空').max(100),
  model: z.string().trim().min(1, '供应商模型标识不能为空').max(300),
  modality: aiModelModalitySchema,
  isEnabled: z.boolean().default(true),
})

/** 算法单步骤允许管理员调整的模型调用参数。 */
export const aiAlgorithmStepParametersSchema = z.object({
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(64).max(8_192),
  timeoutMs: z.number().int().min(1_000).max(120_000),
})

/** 算法配置中的一个固定步骤。 */
export const saveAiAlgorithmStepSchema = z.object({
  stepKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, '算法步骤标识无效'),
  modelDeploymentId: z.string().uuid('模型部署标识无效'),
  parameters: aiAlgorithmStepParametersSchema,
})

/** 发布一版完整算法配置；步骤集合与顺序由服务端算法定义校验。 */
export const publishAiAlgorithmConfigurationSchema = z.object({
  steps: z.array(saveAiAlgorithmStepSchema).min(1, '算法至少需要一个步骤').max(10),
})

export type CreateAiConnectionInput = z.infer<typeof createAiConnectionSchema>
export type UpdateAiConnectionInput = z.infer<typeof updateAiConnectionSchema>
export type SaveAiModelDeploymentInput = z.infer<typeof saveAiModelDeploymentSchema>
export type AiAlgorithmStepParameters = z.infer<typeof aiAlgorithmStepParametersSchema>
export type PublishAiAlgorithmConfigurationInput = z.infer<typeof publishAiAlgorithmConfigurationSchema>
