import type {
  DocumentSpec,
  InterestAssessment,
  SceneContext,
  TextModelParameters,
} from '../../../shared/schemas/generation'

export type RunKind = 'interest_assessment' | 'artifact_generation'
export type RunStatus = 'planning' | 'awaiting_confirmation' | 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'canceled'

/** 运行绑定的非敏感文本模型快照。 */
export interface TextModelSnapshot {
  /** 适配器协议标识。 */
  provider: 'openai_compatible'
  /** 实际使用的模型名称。 */
  model: string
  /** 不包含查询和凭据的服务来源。 */
  endpointOrigin: string
}

/** 一次兴趣或生成运行的完整事实记录。 */
export interface GenerationRunRecord {
  id: string
  kind: RunKind
  personaVersionId: string
  formatTemplateId: string | null
  parameterProfileId: string | null
  status: RunStatus
  input: { content: string } | { requirement: string }
  scene: SceneContext | null
  parameterSnapshot: TextModelParameters
  modelSnapshot: TextModelSnapshot
  promptVersion: string
  contextProvider: 'sqlite_fts5' | 'openviking'
  result: InterestAssessment | null
  usage: TextModelUsage | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

/** 模型供应商返回的可审计用量。 */
export interface TextModelUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

/** 运行中复制保存的证据快照。 */
export interface EvidenceSnapshotRecord {
  id: string
  runId: string
  sourceId: string | null
  chunkId: string | null
  role: 'user_setting' | 'canon_fact' | 'reference' | 'style_sample'
  content: string
  contentHash: string
  rank: number
  metadata: Record<string, unknown>
  createdAt: number
}

/** 文档规格的不可变修订记录。 */
export interface DocumentSpecRecord {
  id: string
  runId: string
  revision: number
  status: 'draft' | 'confirmed' | 'superseded'
  spec: DocumentSpec
  confirmedAt: number | null
  createdAt: number
}

/** 参数方案的不可变版本。 */
export interface ParameterProfileRecord {
  id: string
  name: string
  version: number
  scope: 'system' | 'persona' | 'template'
  values: TextModelParameters
  isActive: boolean
  createdAt: number
}

/** 格式模板的不可变版本。 */
export interface FormatTemplateRecord {
  id: string
  name: string
  version: number
  spec: { guidance: string, minimumBlocks: number, maximumBlocks: number }
  isActive: boolean
  createdAt: number
}

/** 文档中的持久化文字块。 */
export interface ArtifactBlockRecord {
  id: string
  documentId: string
  specKey: string
  ordinal: number
  type: 'text'
  role: 'heading' | 'paragraph' | 'list' | 'quote'
  spec: DocumentSpec['blocks'][number]
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  selectedAttemptId: string | null
  isLocked: boolean
  createdAt: number
  updatedAt: number
}

/** 文字块不可覆盖的单次尝试。 */
export interface BlockAttemptRecord {
  id: string
  blockId: string
  attemptNo: number
  status: 'running' | 'succeeded' | 'failed'
  inputSnapshot: Record<string, unknown>
  outputText: string | null
  usage: TextModelUsage | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: number
  completedAt: number | null
}
