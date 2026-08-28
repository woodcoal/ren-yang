import type { ArtifactFormat, DocumentSpec, InterestAssessment, SceneContext, TextModelParameters } from '../schemas/generation'

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

/** 运行列表及详情共用摘要。 */
export interface RunSummary {
  id: string
  kind: 'interest_assessment' | 'artifact_generation'
  personaVersionId: string
  personaId: string
  personaName: string
  status: 'planning' | 'awaiting_confirmation' | 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'canceled'
  input: { content: string } | { requirement: string, includeImages: boolean }
  scene: SceneContext | null
  parameters: TextModelParameters
  model: { provider: 'openai_compatible', model: string, endpointOrigin: string }
  imageModel: { provider: 'openai_compatible_images', model: string, endpointOrigin: string } | null
  promptVersion: string
  contextProvider: 'sqlite_fts5' | 'openviking'
  result: InterestAssessment | null
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
  role: 'user_setting' | 'canon_fact' | 'reference' | 'style_sample'
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
  /** 成功图片尝试的本地资产；文字尝试为 null。 */
  asset: {
    id: string
    relativePath: string
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
    sizeBytes: number
    contentHash: string
    altText: string
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
  }>
}
