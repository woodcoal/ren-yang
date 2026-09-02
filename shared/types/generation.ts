import type { ArtifactFormat, DocumentSpec, InterestAssessment, SceneContext, TextModelParameters } from '../schemas/generation'

/** 模型供应商返回的可审计用量；供应商未返回的字段为 null。 */
export interface TextModelUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  /** 供应商明确返回的提示词缓存命中 Token；不支持时省略。 */
  cachedInputTokens?: number | null
}

/** 运行提示词中可独立限额的上下文分类。 */
export type PromptContextCategory = 'world_growth' | 'persona_growth' | 'persona_memory' | 'source'

/** 运行最终选入或因预算跳过的一项上下文。 */
export interface PromptContextItemSnapshot {
  /** SQLite 业务实体 UUID。 */
  entityId: string
  /** 所属预算分类。 */
  category: PromptContextCategory
  /** 证据角色。 */
  role: 'growth' | 'memory' | 'canon_fact' | 'reference' | 'style_sample'
  /** 固定正文 SHA-256。 */
  contentHash: string
  /** 调用前估算 Token。 */
  estimatedTokens: number
  /** 未选入时的稳定原因；已选入时为空。 */
  skippedReason: 'category_budget' | 'parent_budget' | 'total_budget' | 'scope_or_state_invalid' | null
}

/** 新运行创建时固定的完整心智与提示预算快照。 */
export interface PromptContextSnapshot {
  /** 新运行锁定的提示词编码到不可变版本 UUID；迁移前旧运行可缺失。 */
  aiPromptVersions?: Record<string, string>
  /** Token 计数器和是否精确的说明。 */
  tokenCounter: string
  /** 当前计数是否为供应商精确分词。 */
  tokenCountExact: boolean
  /** 模型可用输入预算。 */
  availableInputTokens: number
  /** 初始模型调用预计输入量。 */
  estimatedInputTokens: number
  /** 各级预算及实际估算量。 */
  budgets: {
    world: { limit: number, used: number, soulLimit: number, soulUsed: number, growthLimit: number, growthUsed: number }
    persona: { limit: number, used: number, soulLimit: number, soulUsed: number, growthLimit: number, growthUsed: number, memoryLimit: number, memoryUsed: number }
    sources: { limit: number, used: number }
  }
  /** 运行固定使用的世界灵魂版本；独立人物或世界未发布时为空。 */
  worldSoulVersionId: string | null
  /** 运行固定使用的人物灵魂版本。 */
  personaSoulVersionId: string
  /** 最终选入的成长、记忆与资料。 */
  selected: PromptContextItemSnapshot[]
  /** 因预算、范围或状态未进入提示词的条目。 */
  skipped: PromptContextItemSnapshot[]
  /** 初始模型调用最终系统提示哈希。 */
  systemPromptHash: string
  /** 初始模型调用最终用户提示哈希。 */
  userPromptHash: string
}

/** 文本模型能力状态，不暴露密钥。 */
export interface TextModelCapability {
  configured: boolean
  provider: 'openai_compatible'
  model: string | null
  endpointOrigin: string | null
}

/** 图片模型能力状态，不暴露密钥。 */
export interface ImageModelCapability {
  configured: boolean
  provider: 'openai_compatible_images'
  model: string | null
  endpointOrigin: string | null
}

/** 创建异步运行后的标识。 */
export interface CreatedRun {
  runId: string
  taskId: string
  status: 'planning' | 'queued'
}

/** 创建兴趣批次后立即返回的排队视图。 */
export interface CreatedInterestBatch {
  /** 批次 UUID。 */
  batchId: string
  /** 本批次唯一人物 UUID。 */
  personaId: string
  /** 创建时锁定的人物名称。 */
  personaName: string
  /** 对整批生效的临时附加提示词。 */
  additionalPrompt: string
  /** 新建批次固定处于排队状态。 */
  status: 'queued'
  /** 严格保持请求顺序的条目。 */
  items: Array<InterestBatchItemView & { status: 'queued' }>
  /** 创建时间。 */
  createdAt: number
  /** 新建时与创建时间相同。 */
  updatedAt: number
}

/** 兴趣批次中一个独立运行的公开结果。 */
export interface InterestBatchItemView {
  /** 客户端提供且批次内唯一的稳定编号。 */
  itemId: string
  /** 独立兴趣运行 UUID。 */
  runId: string
  /** 本条原始待判断文本。 */
  text: string
  /** 当前条目状态。 */
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  /** 成功时的三态兴趣结论。 */
  decision: InterestAssessment['decision'] | null
  /** 成功时的兴趣概率。 */
  probability: number | null
  /** 成功时的模型置信度。 */
  confidence: number | null
  /** 成功时的简短理由。 */
  reason: string | null
  /** 失败时的稳定错误。 */
  error: { code: string, message: string } | null
}

/** 按输入顺序返回的完整兴趣批次。 */
export interface InterestBatchView {
  /** 批次 UUID。 */
  batchId: string
  /** 本批次唯一人物 UUID。 */
  personaId: string
  /** 当前人物名称；人物已删除时返回稳定占位名称。 */
  personaName: string
  /** 对整批生效的临时附加提示词。 */
  additionalPrompt: string
  /** 全部条目均终止时为 completed。 */
  status: 'queued' | 'running' | 'completed'
  /** 严格保持请求顺序的逐项结果。 */
  items: InterestBatchItemView[]
  /** 创建时间。 */
  createdAt: number
  /** 最后更新时间。 */
  updatedAt: number
}

/** 同步优先兴趣接口在等待完成或降级排队时返回的统一结果。 */
export interface SynchronousInterestBatchView {
  /** completed 表示限时内结束，queued 表示调用方应继续查询。 */
  mode: 'completed' | 'queued'
  /** 当前批次完整结果；即使降级排队也保留稳定批次标识。 */
  batch: InterestBatchView
}

/** 运行列表及详情共用摘要。 */
export interface RunSummary {
  id: string
  kind: 'interest_assessment' | 'artifact_generation'
  personaVersionId: string
  personaId: string
  personaName: string
  status: 'planning' | 'awaiting_confirmation' | 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'canceled'
  input: { content: string, additionalPrompt?: string } | { requirement: string, outputFormat: 'html' | 'text', imageCount: number }
  scene: SceneContext | null
  parameters: TextModelParameters
  model: { provider: 'openai_compatible', model: string, endpointOrigin: string }
  imageModel: { provider: 'openai_compatible_images', model: string, endpointOrigin: string } | null
  promptVersion: string
  contextProvider: 'sqlite_fts5' | 'openviking'
  /** 创建运行时固定的心智选择与预算；旧运行为空。 */
  promptContext: PromptContextSnapshot | null
  result: InterestAssessment | null
  /** 当前运行已持久化的供应商用量；供应商未提供时字段为 null。 */
  usage: TextModelUsage | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

/** 运行证据快照公开视图。 */
export interface EvidenceSnapshotView {
  id: string
  sourceId: string | null
  chunkId: string | null
  role: 'user_setting' | 'canon_fact' | 'reference' | 'style_sample' | 'growth' | 'memory'
  content: string
  contentHash: string
  rank: number
  metadata: Record<string, unknown>
}

/** 文档规格修订公开视图。 */
export interface DocumentSpecView {
  id: string
  revision: number
  status: 'draft' | 'confirmed' | 'superseded'
  spec: DocumentSpec
  confirmedAt: number | null
  createdAt: number
}

/** 块尝试公开视图。 */
export interface BlockAttemptView {
  id: string
  attemptNo: number
  status: 'running' | 'succeeded' | 'failed'
  outputText: string | null
  /** 本次文字模型调用的供应商用量；图片或调用前失败时为 null。 */
  usage: TextModelUsage | null
  /** 成功图片尝试的本地资产；文字尝试为 null。 */
  asset: {
    id: string
    relativePath: string
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
    sizeBytes: number
    contentHash: string
    altText: string
    /** 发生二次裁剪时保留的原图元数据。 */
    original: {
      relativePath: string
      mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
      sizeBytes: number
      contentHash: string
    } | null
  } | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: number
  completedAt: number | null
}

/** 产物文字块公开视图。 */
export interface ArtifactBlockView {
  id: string
  specKey: string
  ordinal: number
  type: 'text' | 'image'
  role: 'heading' | 'paragraph' | 'list' | 'quote' | 'hero_image' | 'illustration'
  instruction: string
  acceptanceCriteria: string[]
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled'
  selectedAttemptId: string | null
  isLocked: boolean
  selectedAt: number | null
  lockedAt: number | null
  attempts: BlockAttemptView[]
}

/** 单次运行完整公开详情。 */
export interface RunDetails {
  run: RunSummary
  evidence: EvidenceSnapshotView[]
  documentSpecs: DocumentSpecView[]
  blocks: ArtifactBlockView[]
  tasks: Array<{
    id: string
    type: string
    status: string
    attemptCount: number
    maxAttempts: number
    lastError: string | null
    createdAt: number
    updatedAt: number
  }>
}

/** 同步优先图文接口返回的运行详情与可选最终产物。 */
export interface SynchronousGenerationRunView {
  /** completed 表示运行已终止，queued 表示调用方应继续查询。 */
  mode: 'completed' | 'queued'
  /** 创建运行时首个持久任务的稳定标识。 */
  taskId: string
  /** 当前运行、块和任务的完整快照。 */
  details: RunDetails
  /** 成功或部分成功时的直接渲染结果；排队、失败或取消时为空。 */
  result: RenderedArtifactView | null
}

/** 参数方案公开视图。 */
export interface ParameterProfileView {
  id: string
  name: string
  version: number
  values: TextModelParameters
  isActive: boolean
  createdAt: number
}

/** 格式模板公开视图。 */
export interface FormatTemplateView {
  id: string
  name: string
  version: number
  spec: { guidance: string, minimumBlocks: number, maximumBlocks: number }
  isActive: boolean
  createdAt: number
}

/** 同一组选中块即时渲染的多格式预览。 */
export interface RenderedArtifactView {
  /** 运行 UUID。 */
  runId: string
  /** 按请求返回的文档文本。 */
  documents: Partial<Record<ArtifactFormat, string>>
  /** 渲染引用的本地图片资产。 */
  assets: Array<{
    id: string
    relativePath: string
    mediaType: string
    sizeBytes: number
    contentHash: string
    altText: string
    /** 发生二次裁剪时保留的原图元数据。 */
    original: {
      relativePath: string
      mediaType: string
      sizeBytes: number
      contentHash: string
    } | null
  }>
}
