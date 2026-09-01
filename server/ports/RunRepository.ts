import type { DocumentSpec, TextModelParameters } from '../../shared/schemas/generation'
import type { PromptContextSnapshot } from '../../shared/types/generation'
import type {
  ArtifactBlockRecord,
  BlockAttemptRecord,
  DocumentSpecRecord,
  EvidenceSnapshotRecord,
  FormatTemplateRecord,
  GenerationRunRecord,
  ImageAssetRecord,
  ImageModelSnapshot,
  ParameterProfileRecord,
  RunKind,
  RunStatus,
  TextModelSnapshot,
  TextModelUsage,
} from '../domain/generation/GenerationModels'

/** 创建运行时要原子写入的证据。 */
export interface NewEvidenceSnapshot {
  id: string
  sourceId: string | null
  chunkId: string | null
  role: EvidenceSnapshotRecord['role']
  content: string
  contentHash: string
  rank: number
  metadata: Record<string, unknown>
}

/** 创建运行、证据和首个任务的原子命令。 */
export interface CreateRunCommand {
  runId: string
  taskId: string
  taskType: 'assess_interest' | 'plan_document'
  kind: RunKind
  personaVersionId: string
  formatTemplateId: string | null
  parameterProfileId: string | null
  status: 'planning' | 'queued'
  input: GenerationRunRecord['input']
  scene: GenerationRunRecord['scene']
  parameters: TextModelParameters
  model: TextModelSnapshot
  imageModel: ImageModelSnapshot | null
  promptVersion: string
  contextProvider: 'sqlite_fts5' | 'openviking'
  /** 最终心智选择、预算和初始提示哈希。 */
  promptContextSnapshot: PromptContextSnapshot
  evidence: NewEvidenceSnapshot[]
  timestamp: number
}

/** 运行列表过滤条件。 */
export interface RunListFilter {
  personaId?: string
  kind?: RunKind
  status?: RunStatus
  limit: number
}

/** 运行关联的人物摘要。 */
export interface RunPersonaIdentity {
  personaId: string
  personaName: string
}

/** 持久任务公开记录。 */
export interface RunTaskRecord {
  id: string
  runId: string
  type: string
  status: string
  attemptCount: number
  maxAttempts: number
  lastError: string | null
  createdAt: number
  updatedAt: number
}

/** 阶段四运行、规格、图文块和资产事实源端口。 */
export interface RunRepository {
  /** @returns 全部参数方案版本。 */
  listParameterProfiles(): Promise<ParameterProfileRecord[]>
  /** @param id 参数方案 UUID。 @returns 参数方案或 null。 */
  findParameterProfile(id: string): Promise<ParameterProfileRecord | null>
  /** @param id 新 UUID。 @param name 方案名称。 @param values 参数值。 @param timestamp 创建时间。 @returns 新版本。 */
  createParameterProfile(id: string, name: string, values: TextModelParameters, timestamp: number): Promise<ParameterProfileRecord>
  /** @returns 全部格式模板版本。 */
  listFormatTemplates(): Promise<FormatTemplateRecord[]>
  /** @param id 模板 UUID。 @returns 模板或 null。 */
  findFormatTemplate(id: string): Promise<FormatTemplateRecord | null>
  /** @param id 新 UUID。 @param name 模板名称。 @param spec 模板规格。 @param timestamp 创建时间。 @returns 新版本。 */
  createFormatTemplate(id: string, name: string, spec: FormatTemplateRecord['spec'], timestamp: number): Promise<FormatTemplateRecord>

  /** @param command 完整原子创建命令。 @returns 无返回值。 */
  createRun(command: CreateRunCommand): Promise<void>
  /** @param filter 列表过滤。 @returns 新运行在前的记录。 */
  listRuns(filter: RunListFilter): Promise<GenerationRunRecord[]>
  /** @param id 运行 UUID。 @returns 运行或 null。 */
  findRun(id: string): Promise<GenerationRunRecord | null>
  /** @param runId 运行 UUID。 @returns 运行绑定人物身份。 */
  findRunPersona(runId: string): Promise<RunPersonaIdentity | null>
  /** @param runId 运行 UUID。 @returns 顺序稳定的证据快照。 */
  listEvidence(runId: string): Promise<EvidenceSnapshotRecord[]>
  /** @param runId 运行 UUID。 @returns 规格修订历史。 */
  listDocumentSpecs(runId: string): Promise<DocumentSpecRecord[]>
  /** @param runId 运行 UUID。 @returns 产物文字块。 */
  listBlocks(runId: string): Promise<ArtifactBlockRecord[]>
  /** @param blockId 块 UUID。 @returns 尝试历史。 */
  listBlockAttempts(blockId: string): Promise<BlockAttemptRecord[]>
  /** @param runId 运行 UUID。 @returns 任务历史。 */
  listRunTasks(runId: string): Promise<RunTaskRecord[]>
  /** @param runId 运行 UUID。 @returns 已收到供应商响应的块尝试用量。 */
  listRunTextUsages(runId: string): Promise<TextModelUsage[]>
  /** @param runId 运行 UUID。 @returns 所属成功图片资产。 */
  listImageAssets(runId: string): Promise<ImageAssetRecord[]>
  /** @param runId 运行 UUID。 @param assetId 资产 UUID。 @returns 所属资产或 null。 */
  findImageAsset(runId: string, assetId: string): Promise<ImageAssetRecord | null>

  /** @param runId 运行 UUID。 @param expected 允许的起始状态。 @param timestamp 更新时间。 @returns 是否开始。 */
  markRunRunning(runId: string, expected: RunStatus[], timestamp: number): Promise<boolean>
  /** @param runId 运行 UUID。 @param result 兴趣结果。 @param usage 模型用量。 @param timestamp 完成时间。 @returns 是否完成。 */
  completeInterestRun(runId: string, result: GenerationRunRecord['result'], usage: TextModelUsage, timestamp: number): Promise<boolean>
  /** @param runId 运行 UUID。 @param specId 规格 UUID。 @param spec AI 规划规格。 @param usage 模型用量。 @param timestamp 完成时间。 @returns 是否保存。 */
  savePlannedDocumentSpec(runId: string, specId: string, spec: DocumentSpec, usage: TextModelUsage, timestamp: number): Promise<boolean>
  /** @param runId 运行 UUID。 @param documentId 文档 UUID。 @param taskId 执行任务 UUID。 @param blockIds 块 UUID。 @param timestamp 确认时间。 @returns 是否确认。 */
  confirmDocumentSpec(runId: string, documentId: string, taskId: string, blockIds: string[], timestamp: number): Promise<boolean>
  /** @param runId 运行 UUID。 @param code 稳定错误码。 @param message 脱敏原因。 @param timestamp 完成时间。 @returns 无返回值。 */
  failRun(runId: string, code: string, message: string, timestamp: number): Promise<void>
  /** @param runId 运行 UUID。 @param usage 已收到但因门禁失败尚未保存的供应商用量。 @param timestamp 更新时间。 @returns 无返回值。 */
  saveRunUsage(runId: string, usage: TextModelUsage, timestamp: number): Promise<void>
  /** @param runId 运行 UUID。 @param taskType 当前任务类型。 @param timestamp 更新时间。 @returns 无返回值。 */
  prepareAutomaticRetry(runId: string, taskType: string, timestamp: number): Promise<void>
  /** @param runId 运行 UUID。 @param taskId 新任务 UUID。 @param timestamp 创建时间。 @returns 新任务类型和运行状态；不可重试时返回 null。 */
  retryRun(runId: string, taskId: string, timestamp: number): Promise<{ taskType: string, status: 'planning' | 'queued' } | null>
  /** @param runId 运行 UUID。 @param timestamp 请求时间。 @returns 是否接受取消。 */
  requestCancellation(runId: string, timestamp: number): Promise<boolean>
  /** @param runId 运行 UUID。 @returns 是否已请求取消。 */
  isCancellationRequested(runId: string): Promise<boolean>
  /** @param runId 运行 UUID。 @param timestamp 完成时间。 @returns 无返回值。 */
  markRunCanceled(runId: string, timestamp: number): Promise<void>
  /** @param runId 运行 UUID。 @param timestamp 恢复时间。 @returns 被恢复的中断块数量。 */
  recoverInterruptedDocumentBlocks(runId: string, timestamp: number): Promise<number>

  /** @param blockId 块 UUID。 @param attemptId 尝试 UUID。 @param inputSnapshot 输入快照。 @param timestamp 开始时间。 @returns 新尝试或 null。 */
  startBlockAttempt(blockId: string, attemptId: string, inputSnapshot: Record<string, unknown>, timestamp: number): Promise<BlockAttemptRecord | null>
  /** @param blockId 块 UUID。 @param attemptId 尝试 UUID。 @param outputText 纯文本结果。 @param usage 模型用量。 @param timestamp 完成时间。 @returns 无返回值。 */
  completeBlockAttempt(blockId: string, attemptId: string, outputText: string, usage: TextModelUsage, timestamp: number): Promise<void>
  /** @param blockId 块 UUID。 @param attemptId 尝试 UUID。 @param asset 完整图片资产事实。 @param timestamp 完成时间。 @returns 无返回值。 */
  completeImageBlockAttempt(blockId: string, attemptId: string, asset: Omit<ImageAssetRecord, 'attemptId' | 'createdAt'>, timestamp: number): Promise<void>
  /** @param blockId 块 UUID。 @param attemptId 尝试 UUID。 @param code 稳定错误码。 @param message 脱敏原因。 @param usage 已收到供应商响应时的用量。 @param timestamp 完成时间。 @returns 无返回值。 */
  failBlockAttempt(blockId: string, attemptId: string, code: string, message: string, usage: TextModelUsage | null, timestamp: number): Promise<void>
  /** @param runId 运行 UUID。 @param timestamp 完成时间。 @returns 最终运行状态。 */
  finishDocumentRun(runId: string, timestamp: number): Promise<'succeeded' | 'partial' | 'failed'>
}
