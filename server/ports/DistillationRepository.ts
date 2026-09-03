import type { PersonaDistillationMode, PersonaDistillationSourceRole, PersonaDistillationStatus } from '../../shared/types/personaDistillation'

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

/** 创建人物蒸馏运行、输入和唯一分析任务的原子命令。 */
export interface CreatePersonaDistillationRunRecord {
  /** 新运行 UUID。 */
  id: string
  /** 唯一自由分析任务 UUID。 */
  taskId: string
  /** 重试来源运行 UUID。 */
  retryOfRunId: string | null
  /** 创建新人物或更新已有人物。 */
  mode: PersonaDistillationMode
  /** 更新模式的目标人物 UUID；创建模式为 null。 */
  createdPersonaId: string | null
  /** 重新蒸馏创建时固定的当前灵魂版本；创建模式为 null。 */
  baseSoulVersionId: string | null
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

/** 保存单次自由分析报告和候选灵魂的命令。 */
export interface SavePersonaDistillationAnalysisRecord {
  /** 仍处于分析阶段的运行 UUID。 */
  runId: string
  /** 模型返回的原始最小结果包。 */
  rawResult: unknown
  /** 面向人工审阅的完整分析报告。 */
  analysisReport: string
  /** 模型建议人物名称。 */
  candidateName: string
  /** 完整单文本灵魂候选。 */
  candidatePromptText: string
  /** 候选正文 SHA-256。 */
  candidatePromptHash: string
  /** 保存时间。 */
  timestamp: number
}

/** 保存人工编辑候选的命令。 */
export interface SavePersonaDistillationCandidateRecord {
  /** 当前等待候选审核的运行 UUID。 */
  runId: string
  /** 页面读取到的运行更新时间。 */
  expectedUpdatedAt: number
  /** 人工编辑后的完整灵魂正文。 */
  candidatePromptText: string
  /** 新候选正文 SHA-256。 */
  candidatePromptHash: string
  /** 保存时间。 */
  timestamp: number
}

/** 最终确认候选并原子创建人物或更新人物灵魂的命令。 */
export interface ConfirmPersonaDistillationCandidateRecord {
  /** 等待候选审核的运行 UUID。 */
  runId: string
  /** 页面读取到的运行更新时间。 */
  expectedUpdatedAt: number
  /** 页面确认的已准备候选 SHA-256。 */
  expectedPromptHash: string
  /** 新人物或已有目标人物 UUID。 */
  personaId: string
  /** 将发布的新灵魂版本 UUID。 */
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
  /** 新分析任务 UUID。 */
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
}

/** 人物蒸馏运行及其当前输入快照。 */
export interface PersonaDistillationRunRecord {
  /** 运行 UUID。 */
  id: string
  /** 重试来源运行 UUID。 */
  retryOfRunId: string | null
  /** 创建新人物或更新已有人物。 */
  mode: PersonaDistillationMode
  /** 重新蒸馏创建时固定的当前灵魂版本。 */
  baseSoulVersionId: string | null
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
  /** 面向人工审阅的模型分析报告。 */
  analysisReport: string | null
  /** 非敏感固定算法快照。 */
  algorithmSnapshot: unknown
  /** 模型建议人物名称。 */
  candidateName: string | null
  /** 当前人物候选灵魂正文。 */
  candidatePromptText: string | null
  /** 当前候选正文 SHA-256。 */
  candidatePromptHash: string | null
  /** 由本次分析或人工编辑准备好的正文 SHA-256。 */
  preparedPromptHash: string | null
  /** 最终确认时保存的人工正文。 */
  reviewedPromptText: string | null
  /** 本次蒸馏创建或更新的人物 UUID；创建模式在完成前为 null。 */
  createdPersonaId: string | null
  /** 稳定错误码。 */
  errorCode: string | null
  /** 脱敏错误说明。 */
  errorMessage: string | null
  /** 本次运行的固定输入。 */
  inputs: PersonaDistillationInputRecord[]
  /** 创建时间。 */
  createdAt: number
  /** 更新时间。 */
  updatedAt: number
  /** 完成时间。 */
  completedAt: number | null
}

/** 人物蒸馏运行的持久化接缝。 */
export interface DistillationRepository {
  /** @param record 完整运行、输入和唯一分析任务命令。 @returns 原子写入完成时结束。 */
  createRun(record: CreatePersonaDistillationRunRecord): Promise<void>
  /** @param runId 运行 UUID。 @returns 完整运行或 null。 */
  findRun(runId: string): Promise<PersonaDistillationRunRecord | null>
  /** @param record 自由分析报告、候选与保存时间。 @returns 运行仍允许保存时为 true。 */
  saveAnalysis(record: SavePersonaDistillationAnalysisRecord): Promise<boolean>
  /** @param record 人工编辑候选和并发版本。 @returns 保存成功时为 true。 */
  saveCandidate(record: SavePersonaDistillationCandidateRecord): Promise<boolean>
  /** @param runId 运行 UUID。 @param timestamp 请求时间。 @returns 当前状态允许取消时为 true。 */
  requestCancellation(runId: string, timestamp: number): Promise<boolean>
  /** @param runId 运行 UUID。 @returns 是否已有运行中任务请求取消。 */
  isCancellationRequested(runId: string): Promise<boolean>
  /** @param runId 运行 UUID。 @param timestamp 安全取消时间。 @returns 运行和任务取消完成时结束。 */
  markRunCanceled(runId: string, timestamp: number): Promise<void>
  /** @param record 候选哈希、人物与版本标识、预算和并发版本。 @returns 原子创建或更新人物并完成运行时为 true。 */
  confirmCandidate(record: ConfirmPersonaDistillationCandidateRecord): Promise<boolean>
  /** @param runId 运行 UUID。 @param code 稳定错误码。 @param message 脱敏错误。 @param timestamp 失败时间。 @returns 执行状态仍允许失败时为 true。 */
  failRun(runId: string, code: string, message: string, timestamp: number): Promise<boolean>
  /** @param record 来源运行、新标识和时间。 @returns 来源运行仍失败且输入可用时为 true。 */
  createRetry(record: CreatePersonaDistillationRetryRecord): Promise<boolean>
}
