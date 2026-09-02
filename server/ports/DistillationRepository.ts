import type {
  PersonaDistillationCoverageDimension,
  PersonaDistillationSourceRelation,
  PersonaDistillationStatus,
} from '../../shared/types/personaDistillation'
import type { ModelPersonaDistillationSourceAssessment } from '../../shared/schemas/personaDistillation'
import type {
  PersonaDistillationCoverage,
  PersonaDistillationQualityGate,
  ValidatedPersonaDistillationClaim,
} from '../domain/distillation/PersonaDistillation'

/** 人物蒸馏可引用的现有资料角色。 */
export type PersonaDistillationSourceRole = 'canon_fact' | 'reference' | 'style_sample'

/** 创建人物蒸馏运行时固定的一项输入。 */
export interface CreatePersonaDistillationInputRecord {
  /** 运行内输入 UUID。 */
  id: string
  /** 已导入资料或用户明确要求。 */
  inputType: 'source_material' | 'user_statement'
  /** 原资料 UUID；用户要求没有资料实体。 */
  sourceId: string | null
  /** 用户可见输入名称。 */
  name: string
  /** 已导入资料的业务角色。 */
  sourceRole: PersonaDistillationSourceRole | null
  /** 资料与目标人物的关系；资料评估前可以为空。 */
  sourceRelation: PersonaDistillationSourceRelation | null
  /** 当前确认的分析覆盖维度。 */
  coverageDimensions: PersonaDistillationCoverageDimension[]
  /** 原始作品、访谈或事件的稳定分组键。 */
  independentSourceKey: string | null
  /** 完整原文 SHA-256。 */
  contentHash: string
  /** 本次运行实际使用的不可变正文。 */
  contentSnapshot: string
  /** 可选原始来源地址。 */
  originUrl: string | null
  /** 可选作者或发言者。 */
  authorName: string | null
  /** 可选发表或发生时间。 */
  publishedAt: number | null
}

/** 创建人物蒸馏运行、输入和首个任务的原子命令。 */
export interface CreatePersonaDistillationRunRecord {
  /** 新运行 UUID。 */
  id: string
  /** 首个资料评估任务 UUID。 */
  taskId: string
  /** 重试来源运行 UUID。 */
  retryOfRunId: string | null
  /** 用户填写的候选人物名称。 */
  requestedName: string
  /** 使用目的与聚焦方向。 */
  objective: string
  /** 可选世界 UUID。 */
  worldId: string | null
  /** 创建时固定的上下文提供器。 */
  provider: 'sqlite_fts5' | 'openviking'
  /** 非敏感固定算法快照。 */
  algorithmSnapshot: unknown
  /** 用户要求与资料正文快照。 */
  inputs: CreatePersonaDistillationInputRecord[]
  /** 创建时间，UTC Unix 毫秒。 */
  timestamp: number
}

/** 保存模型资料分类和程序覆盖统计的命令。 */
export interface SavePersonaDistillationSourceAssessmentRecord {
  /** 仍处于资料评估阶段的运行 UUID。 */
  runId: string
  /** 已与运行输入一一对应的资料分类。 */
  assessment: ModelPersonaDistillationSourceAssessment
  /** 按独立来源计算的覆盖统计。 */
  coverage: PersonaDistillationCoverage
  /** 保存时间。 */
  timestamp: number
}

/** 用户确认时对运行级资料分类的可选纠正。 */
export interface PersonaDistillationSourceCorrectionRecord {
  /** 运行输入 UUID。 */
  inputId: string
  /** 可选新来源关系。 */
  sourceRelation?: Exclude<PersonaDistillationSourceRelation, 'user_statement'>
  /** 可选新覆盖维度。 */
  coverageDimensions?: PersonaDistillationCoverageDimension[]
}

/** 确认资料范围并原子排入认知提取任务的命令。 */
export interface ConfirmPersonaDistillationSourcesRecord {
  /** 待确认运行 UUID。 */
  runId: string
  /** 页面读取到的运行更新时间。 */
  expectedUpdatedAt: number
  /** 用户确认进入认知提取的资料输入 UUID。 */
  acceptedInputIds: string[]
  /** 用户对模型分类的纠正。 */
  corrections: PersonaDistillationSourceCorrectionRecord[]
  /** 新认知提取任务 UUID。 */
  taskId: string
  /** 确认时间。 */
  timestamp: number
}

/** 持久化认知候选引用的一项精确证据。 */
export interface PersonaDistillationEvidenceRecord {
  /** 证据引用 UUID。 */
  id: string
  /** 本次运行输入 UUID。 */
  inputId: string
  /** 支持或反对关系。 */
  relation: 'supporting' | 'opposing'
  /** 能在固定输入中定位的原文。 */
  quote: string
  /** 引文 SHA-256。 */
  quoteHash: string
}

/** 带持久化标识和精确证据的人物认知候选。 */
export interface PersonaDistillationClaimRecord extends Omit<ValidatedPersonaDistillationClaim, 'evidence'> {
  /** 候选 UUID。 */
  id: string
  /** 已完成定位和哈希计算的证据引用。 */
  evidence: PersonaDistillationEvidenceRecord[]
}

/** 保存认知提取、程序校验和质量门禁的命令。 */
export interface SavePersonaDistillationExtractionRecord {
  /** 仍处于认知提取阶段的运行 UUID。 */
  runId: string
  /** 模型原始结构化输出。 */
  rawExtraction: unknown
  /** 已通过程序校验的候选。 */
  claims: PersonaDistillationClaimRecord[]
  /** 进入灵魂综合前的分级质量门禁。 */
  qualityGate: PersonaDistillationQualityGate
  /** 保存时间。 */
  timestamp: number
}

/** 保存模型综合人物候选灵魂的命令。 */
export interface SavePersonaDistillationSynthesisRecord {
  /** 仍处于灵魂综合阶段的运行 UUID。 */
  runId: string
  /** 模型建议人物名称。 */
  candidateName: string
  /** 完整单文本灵魂候选。 */
  candidatePromptText: string
  /** 候选正文 SHA-256。 */
  candidatePromptHash: string
  /** 保存时间。 */
  timestamp: number
}

/** 一项只追加的人物候选评测。 */
export interface PersonaDistillationEvaluationRecord {
  /** 评测 UUID。 */
  id: string
  /** 同一候选编辑后的评测轮次。 */
  roundNo: number
  /** 固定评测维度。 */
  evaluationType: 'known_fact' | 'decision_tendency' | 'unknown_boundary' | 'expression' | 'counterfactual' | 'conflict_handling'
  /** 评测输入快照。 */
  input: unknown
  /** 可公开的期望约束。 */
  expected: unknown
  /** 模型或程序输出。 */
  output: unknown
  /** 当前维度结果。 */
  status: 'passed' | 'warning' | 'failed'
  /** 0 到 1 的可选辅助评分。 */
  score: number | null
  /** 具体失败原因。 */
  failureReasons: string[]
}

/** 保存一轮候选评测并进入人工候选审核的命令。 */
export interface SavePersonaDistillationEvaluationRecord {
  /** 仍处于评测阶段的运行 UUID。 */
  runId: string
  /** 本轮实际评测的候选正文哈希。 */
  candidatePromptHash: string
  /** 六类只追加评测结果。 */
  evaluations: PersonaDistillationEvaluationRecord[]
  /** 阻止最终确认的硬失败。 */
  hardFailures: string[]
  /** 保存时间。 */
  timestamp: number
}

/** 保存人工编辑候选并原子排入重新评测任务的命令。 */
export interface SavePersonaDistillationCandidateRecord {
  /** 当前等待候选审核的运行 UUID。 */
  runId: string
  /** 页面读取到的运行更新时间。 */
  expectedUpdatedAt: number
  /** 人工编辑后的完整灵魂正文。 */
  candidatePromptText: string
  /** 新候选正文 SHA-256。 */
  candidatePromptHash: string
  /** 新评测任务 UUID。 */
  taskId: string
  /** 保存时间。 */
  timestamp: number
}

/** 最终确认候选并原子创建人物及初始灵魂版本的命令。 */
export interface ConfirmPersonaDistillationCandidateRecord {
  /** 等待候选审核的运行 UUID。 */
  runId: string
  /** 页面读取到的运行更新时间。 */
  expectedUpdatedAt: number
  /** 页面确认的已评测候选 SHA-256。 */
  expectedPromptHash: string
  /** 新人物 UUID。 */
  personaId: string
  /** 新初始灵魂版本 UUID。 */
  soulVersionId: string
  /** 人工确认的人物名称。 */
  name: string
  /** 初始灵魂的 Token 数量。 */
  runtimeTokenCount: number
  /** Token 计数器说明。 */
  tokenCounter: string
  /** 确认时间。 */
  timestamp: number
}

/** 从失败运行的固定输入创建新重试运行的命令。 */
export interface CreatePersonaDistillationRetryRecord {
  /** 必须已经失败的来源运行 UUID。 */
  sourceRunId: string
  /** 新运行 UUID。 */
  runId: string
  /** 新资料评估任务 UUID。 */
  taskId: string
  /** 与来源运行输入顺序一一对应的新输入 UUID。 */
  inputIds: string[]
  /** 创建时间。 */
  timestamp: number
}

/** 人物蒸馏运行的一项持久化输入。 */
export interface PersonaDistillationInputRecord extends Omit<CreatePersonaDistillationInputRecord, 'contentSnapshot'> {
  /** 实际发送给模型的固定正文；原资料明确删除后为空。 */
  contentSnapshot: string | null
  /** 原始正文当前是否仍可用。 */
  sourceAvailable: boolean
  /** 用户是否确认该输入进入认知提取。 */
  accepted: boolean
}

/** 人物蒸馏运行及其当前输入快照。 */
export interface PersonaDistillationRunRecord {
  /** 运行 UUID。 */
  id: string
  /** 重试来源运行 UUID。 */
  retryOfRunId: string | null
  /** 当前状态。 */
  status: PersonaDistillationStatus
  /** 用户填写的候选人物名称。 */
  requestedName: string
  /** 使用目的与聚焦方向。 */
  objective: string
  /** 可选世界 UUID。 */
  worldId: string | null
  /** 创建时固定的上下文提供器。 */
  provider: 'sqlite_fts5' | 'openviking'
  /** 可选六维覆盖快照。 */
  coverageSnapshot: unknown | null
  /** 非敏感固定算法快照。 */
  algorithmSnapshot: unknown
  /** 模型原始认知提取结果。 */
  rawExtraction: unknown | null
  /** 程序校验后的认知提取结果。 */
  validatedExtraction: unknown | null
  /** 分级质量门禁。 */
  qualityGate: unknown | null
  /** 模型建议人物名称。 */
  candidateName: string | null
  /** 当前人物候选灵魂正文。 */
  candidatePromptText: string | null
  /** 当前候选正文 SHA-256。 */
  candidatePromptHash: string | null
  /** 最近通过硬门禁评测的正文 SHA-256。 */
  evaluatedPromptHash: string | null
  /** 最终确认时保存的人工正文。 */
  reviewedPromptText: string | null
  /** 成功创建的人物 UUID。 */
  createdPersonaId: string | null
  /** 稳定错误码。 */
  errorCode: string | null
  /** 脱敏错误说明。 */
  errorMessage: string | null
  /** 本次运行的固定输入。 */
  inputs: PersonaDistillationInputRecord[]
  /** 程序校验后的认知候选和精确证据。 */
  claims: PersonaDistillationClaimRecord[]
  /** 按轮次只追加的候选评测。 */
  evaluations: PersonaDistillationEvaluationRecord[]
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
  /** 完成时间。 */
  completedAt: number | null
}

/** 人物蒸馏运行的持久化接缝。 */
export interface DistillationRepository {
  /** @param record 完整运行、输入和首个任务命令。 @returns 原子写入完成时结束。 */
  createRun(record: CreatePersonaDistillationRunRecord): Promise<void>
  /** @param runId 运行 UUID。 @returns 完整运行或 null。 */
  findRun(runId: string): Promise<PersonaDistillationRunRecord | null>
  /** @param record 模型分类、程序覆盖和保存时间。 @returns 状态仍允许保存时为 true。 */
  saveSourceAssessment(record: SavePersonaDistillationSourceAssessmentRecord): Promise<boolean>
  /** @param record 人工范围、纠正、并发版本和新任务。 @returns 原子确认成功时为 true。 */
  confirmSources(record: ConfirmPersonaDistillationSourcesRecord): Promise<boolean>
  /** @param record 原始提取、已校验候选和质量门禁。 @returns 运行仍处于提取阶段时为 true。 */
  saveExtraction(record: SavePersonaDistillationExtractionRecord): Promise<boolean>
  /** @param record 候选名称、正文、哈希和保存时间。 @returns 运行仍处于综合阶段时为 true。 */
  saveSynthesis(record: SavePersonaDistillationSynthesisRecord): Promise<boolean>
  /** @param record 与当前候选哈希绑定的完整评测。 @returns 运行仍处于评测阶段且哈希一致时为 true。 */
  saveEvaluation(record: SavePersonaDistillationEvaluationRecord): Promise<boolean>
  /** @param record 新候选、并发版本和评测任务。 @returns 保存与入队同时成功时为 true。 */
  saveCandidateForEvaluation(record: SavePersonaDistillationCandidateRecord): Promise<boolean>
  /** @param runId 运行 UUID。 @param timestamp 请求时间。 @returns 当前状态允许取消时为 true。 */
  requestCancellation(runId: string, timestamp: number): Promise<boolean>
  /** @param runId 运行 UUID。 @returns 是否已有运行中任务请求取消。 */
  isCancellationRequested(runId: string): Promise<boolean>
  /** @param runId 运行 UUID。 @param timestamp 安全取消时间。 @returns 运行和任务取消完成时结束。 */
  markRunCanceled(runId: string, timestamp: number): Promise<void>
  /** @param record 候选哈希、人物与版本标识、预算和并发版本。 @returns 原子创建并完成运行时为 true。 */
  confirmAndCreatePersona(record: ConfirmPersonaDistillationCandidateRecord): Promise<boolean>
  /** @param runId 运行 UUID。 @param code 稳定错误码。 @param message 脱敏错误。 @param timestamp 失败时间。 @returns 执行状态仍允许失败时为 true。 */
  failRun(runId: string, code: string, message: string, timestamp: number): Promise<boolean>
  /** @param record 来源运行、新标识和时间。 @returns 来源运行仍失败且输入可用时为 true。 */
  createRetry(record: CreatePersonaDistillationRetryRecord): Promise<boolean>
}
