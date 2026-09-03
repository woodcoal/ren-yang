/** 人物蒸馏运行的稳定状态。 */
export const PERSONA_DISTILLATION_STATUSES = [
  'analyzing',
  'awaiting_candidate_review',
  'completed',
  'failed',
  'canceled',
] as const

/** 人物蒸馏运行的稳定状态。 */
export type PersonaDistillationStatus = typeof PERSONA_DISTILLATION_STATUSES[number]

/** 人物蒸馏是创建新人物，还是更新已有人物。 */
export type PersonaDistillationMode = 'create' | 'update'

/** 人物蒸馏算法的唯一自由分析步骤。 */
export const PERSONA_DISTILLATION_ALGORITHM_STEPS = ['analyze'] as const

/** 人物蒸馏算法的固定步骤编码。 */
export type PersonaDistillationAlgorithmStep = typeof PERSONA_DISTILLATION_ALGORITHM_STEPS[number]

/** 人物蒸馏可引用的现有资料角色。 */
export type PersonaDistillationSourceRole = 'canon_fact' | 'reference' | 'style_sample'

/** 人物蒸馏运行中的固定输入公开视图。 */
export interface PersonaDistillationInputView {
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
  /** 原文 SHA-256。 */
  contentHash: string
  /** 资料被删除后为空的固定正文。 */
  contentSnapshot: string | null
  /** 原始资料当前是否仍可用。 */
  sourceAvailable: boolean
  /** 可选来源地址。 */
  originUrl: string | null
  /** 可选作者或发言者。 */
  authorName: string | null
  /** 可选发表时间。 */
  publishedAt: number | null
}

/** 网页内部接口返回的人物蒸馏运行公开视图。 */
export interface PersonaDistillationRunView {
  /** 运行 UUID。 */
  id: string
  /** 重试来源运行 UUID。 */
  retryOfRunId: string | null
  /** 创建新人物或更新已有人物。 */
  mode: PersonaDistillationMode
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
  /** 模型自主完成的可读人物分析报告。 */
  analysisReport: string | null
  /** 模型建议人物名称。 */
  candidateName: string | null
  /** 当前人物候选灵魂正文。 */
  candidatePromptText: string | null
  /** 当前候选正文 SHA-256。 */
  candidatePromptHash: string | null
  /** 已准备供人工确认的候选正文 SHA-256。 */
  preparedPromptHash: string | null
  /** 本次蒸馏创建或更新的人物 UUID；创建模式在完成前为 null。 */
  createdPersonaId: string | null
  /** 稳定错误码。 */
  errorCode: string | null
  /** 脱敏错误说明。 */
  errorMessage: string | null
  /** 本次运行的固定输入。 */
  inputs: PersonaDistillationInputView[]
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
  /** 更新时间，UTC Unix 毫秒。 */
  updatedAt: number
  /** 完成时间，UTC Unix 毫秒。 */
  completedAt: number | null
}
