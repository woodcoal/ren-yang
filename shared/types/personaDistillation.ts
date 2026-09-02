/** 人物蒸馏运行的全部稳定状态。 */
export const PERSONA_DISTILLATION_STATUSES = [
  'assessing_sources',
  'awaiting_source_review',
  'extracting',
  'synthesizing',
  'evaluating',
  'awaiting_candidate_review',
  'completed',
  'failed',
  'canceled',
] as const

/** 人物蒸馏运行的稳定状态。 */
export type PersonaDistillationStatus = typeof PERSONA_DISTILLATION_STATUSES[number]

/** 人物蒸馏是创建新人物，还是更新已有人物。 */
export type PersonaDistillationMode = 'create' | 'update'

/** 人物蒸馏算法固定的四个模型步骤及执行顺序。 */
export const PERSONA_DISTILLATION_ALGORITHM_STEPS = [
  'classify_sources',
  'extract_claims',
  'synthesize_soul',
  'evaluate_soul',
] as const

/** 人物蒸馏算法的固定模型步骤编码。 */
export type PersonaDistillationAlgorithmStep = typeof PERSONA_DISTILLATION_ALGORITHM_STEPS[number]

/** 已导入资料与目标人物之间允许使用的来源关系。 */
export const PERSONA_DISTILLATION_MATERIAL_SOURCE_RELATIONS = [
  'subject_authored',
  'direct_conversation',
  'observed_decision',
  'subject_social',
  'third_party',
] as const

/** 已导入资料与目标人物之间允许使用的来源关系。 */
export type PersonaDistillationMaterialSourceRelation = typeof PERSONA_DISTILLATION_MATERIAL_SOURCE_RELATIONS[number]

/** 资料或用户明确要求与目标人物之间的来源关系。 */
export const PERSONA_DISTILLATION_SOURCE_RELATIONS = [
  ...PERSONA_DISTILLATION_MATERIAL_SOURCE_RELATIONS,
  'user_statement',
] as const

/** 资料或用户明确要求与目标人物之间的来源关系。 */
export type PersonaDistillationSourceRelation = typeof PERSONA_DISTILLATION_SOURCE_RELATIONS[number]

/** 人物蒸馏资料能够覆盖的分析维度。 */
export const PERSONA_DISTILLATION_COVERAGE_DIMENSIONS = [
  'writings',
  'conversations',
  'expression',
  'external_views',
  'decisions',
  'timeline',
] as const

/** 人物蒸馏资料能够覆盖的分析维度。 */
export type PersonaDistillationCoverageDimension = typeof PERSONA_DISTILLATION_COVERAGE_DIMENSIONS[number]

/** 人物蒸馏能够形成的结构化认知候选分类。 */
export const PERSONA_DISTILLATION_CLAIM_CATEGORIES = [
  'mental_model',
  'decision_heuristic',
  'expression',
  'value',
  'anti_pattern',
  'tension',
  'honesty_boundary',
  'timeline',
] as const

/** 人物蒸馏能够形成的结构化认知候选分类。 */
export type PersonaDistillationClaimCategory = typeof PERSONA_DISTILLATION_CLAIM_CATEGORIES[number]

/** 认知候选与资料之间的推导关系。 */
export const PERSONA_DISTILLATION_CLAIM_BASES = ['explicit', 'observed', 'inferred'] as const

/** 认知候选与资料之间的推导关系。 */
export type PersonaDistillationClaimBasis = typeof PERSONA_DISTILLATION_CLAIM_BASES[number]

/** 证据对候选结论的支持方向。 */
export const PERSONA_DISTILLATION_EVIDENCE_RELATIONS = ['supporting', 'opposing'] as const

/** 证据对候选结论的支持方向。 */
export type PersonaDistillationEvidenceRelation = typeof PERSONA_DISTILLATION_EVIDENCE_RELATIONS[number]

/** 人物蒸馏可引用的现有资料角色。 */
export type PersonaDistillationSourceRole = 'canon_fact' | 'reference' | 'style_sample'

/** 人物蒸馏资料覆盖的公开统计。 */
export interface PersonaDistillationCoverageView {
  /** 实际输入资料数。 */
  sourceCount: number
  /** 去除同源转载后的独立来源数。 */
  independentSourceCount: number
  /** 人物本人直接来源的独立来源数。 */
  directIndependentSourceCount: number
  /** 同源或重复资料数。 */
  duplicateSourceCount: number
  /** 每个分析维度覆盖的独立来源数。 */
  dimensionIndependentSourceCounts: Record<PersonaDistillationCoverageDimension, number>
  /** 不阻止继续提炼的覆盖警告。 */
  warnings: string[]
}

/** 人物蒸馏质量门禁的公开结果。 */
export interface PersonaDistillationQualityGateView {
  /** 阻止继续或确认的确定性失败。 */
  hardFailures: string[]
  /** 允许继续但必须展示的资料与推断限制。 */
  softWarnings: string[]
}

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
  /** 资料与目标人物的来源关系。 */
  sourceRelation: PersonaDistillationSourceRelation | null
  /** 当前确认的覆盖维度。 */
  coverageDimensions: PersonaDistillationCoverageDimension[]
  /** 原始作品、访谈或事件的稳定分组键。 */
  independentSourceKey: string | null
  /** 原文 SHA-256。 */
  contentHash: string
  /** 资料被删除后为空的固定正文。 */
  contentSnapshot: string | null
  /** 原始资料当前是否仍可用。 */
  sourceAvailable: boolean
  /** 用户是否确认该资料进入提取。 */
  accepted: boolean
  /** 可选来源地址。 */
  originUrl: string | null
  /** 可选作者或发言者。 */
  authorName: string | null
  /** 可选发表时间。 */
  publishedAt: number | null
}

/** 人物认知候选引用的一项精确证据。 */
export interface PersonaDistillationEvidenceView {
  /** 证据 UUID。 */
  id: string
  /** 本次运行输入 UUID。 */
  inputId: string
  /** 支持或反对关系。 */
  relation: PersonaDistillationEvidenceRelation
  /** 能在固定输入中定位的原文。 */
  quote: string
  /** 引文 SHA-256。 */
  quoteHash: string
}

/** 通过程序证据校验的人物认知候选公开视图。 */
export interface PersonaDistillationClaimView {
  /** 候选 UUID。 */
  id: string
  /** 候选分类。 */
  category: PersonaDistillationClaimCategory
  /** 原子陈述。 */
  statement: string
  /** 适用条件。 */
  applicability: string
  /** 失效条件或未知项。 */
  limitations: string
  /** 明确陈述、行为观察或系统推断。 */
  basis: PersonaDistillationClaimBasis
  /** 模型辅助置信度。 */
  confidence: number
  /** 支持证据实际覆盖的独立来源数。 */
  independentSourceCount: number
  /** 支持证据覆盖的不同分析维度数。 */
  crossContextCount: number
  /** 候选是否允许进入综合。 */
  status: 'valid' | 'warning' | 'rejected'
  /** 拒绝进入综合的原因。 */
  rejectionReasons: string[]
  /** 继续使用时必须展示的限制。 */
  warnings: string[]
  /** 尚未消解的冲突。 */
  conflicts: string[]
  /** 已定位的支持或反对证据。 */
  evidence: PersonaDistillationEvidenceView[]
}

/** 一项与候选正文哈希绑定的公开评测。 */
export interface PersonaDistillationEvaluationView {
  /** 评测 UUID。 */
  id: string
  /** 候选编辑后的评测轮次。 */
  roundNo: number
  /** 本轮评测对应的候选正文 SHA-256。 */
  candidatePromptHash: string
  /** 固定评测维度。 */
  evaluationType: 'known_fact' | 'decision_tendency' | 'unknown_boundary' | 'expression' | 'counterfactual' | 'conflict_handling'
  /** 当前维度结果。 */
  status: 'passed' | 'warning' | 'failed'
  /** 0 到 1 的可选辅助评分。 */
  score: number | null
  /** 具体失败原因。 */
  failureReasons: string[]
  /** 不包含隐藏推理的评测结果。 */
  output: unknown
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
  /** 可选六维覆盖快照。 */
  coverageSnapshot: PersonaDistillationCoverageView | null
  /** 分级质量门禁。 */
  qualityGate: PersonaDistillationQualityGateView | null
  /** 模型建议人物名称。 */
  candidateName: string | null
  /** 当前人物候选灵魂正文。 */
  candidatePromptText: string | null
  /** 当前候选正文 SHA-256。 */
  candidatePromptHash: string | null
  /** 最近通过硬门禁评测的正文 SHA-256。 */
  evaluatedPromptHash: string | null
  /** 本次蒸馏创建或更新的人物 UUID；创建模式在完成前为 null。 */
  createdPersonaId: string | null
  /** 稳定错误码。 */
  errorCode: string | null
  /** 脱敏错误说明。 */
  errorMessage: string | null
  /** 本次运行的固定输入。 */
  inputs: PersonaDistillationInputView[]
  /** 程序校验后的认知候选和精确证据。 */
  claims: PersonaDistillationClaimView[]
  /** 按轮次只追加的候选评测。 */
  evaluations: PersonaDistillationEvaluationView[]
  /** 创建时间，UTC Unix 毫秒。 */
  createdAt: number
  /** 更新时间，UTC Unix 毫秒。 */
  updatedAt: number
  /** 完成时间，UTC Unix 毫秒。 */
  completedAt: number | null
}
