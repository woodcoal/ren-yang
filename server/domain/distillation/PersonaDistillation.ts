import { PERSONA_DISTILLATION_COVERAGE_DIMENSIONS } from '../../../shared/types/personaDistillation'
import type {
  PersonaDistillationCoverageDimension,
  PersonaDistillationSourceRelation,
  PersonaDistillationStatus,
} from '../../../shared/types/personaDistillation'
import type {
  ModelPersonaDistillationClaim,
  ModelPersonaDistillationSourceAssessment,
} from '../../../shared/schemas/personaDistillation'

export type { PersonaDistillationStatus } from '../../../shared/types/personaDistillation'

/** 参与人物蒸馏覆盖检查和证据校验的不可变输入。 */
export interface PersonaDistillationInput {
  /** 本次运行内的输入 UUID。 */
  id: string
  /** 资料与目标人物之间的来源关系。 */
  sourceRelation: PersonaDistillationSourceRelation
  /** 该资料能够支持的一个或多个分析维度。 */
  coverageDimensions: readonly PersonaDistillationCoverageDimension[]
  /** 相同原始作品、访谈或事件共享的稳定分组键。 */
  independentSourceKey: string
  /** 实际发送给模型并可供证据定位的固定正文。 */
  content: string
}

/** 通过程序证据校验且可供综合步骤使用的人物认知候选。 */
export interface ValidatedPersonaDistillationClaim extends ModelPersonaDistillationClaim {
  /** 支持证据实际覆盖的独立来源数。 */
  independentSourceCount: number
  /** 支持证据实际覆盖的不同分析维度数。 */
  crossContextCount: number
  /** 候选是否可以进入综合步骤。 */
  status: 'valid' | 'warning' | 'rejected'
  /** 候选被拒绝进入综合步骤的明确原因。 */
  rejectionReasons: string[]
  /** 候选可以继续使用但必须向用户展示的限制。 */
  warnings: string[]
}

/** 人物蒸馏纯领域规则错误。 */
export class PersonaDistillationRuleError extends Error {
  /** 稳定领域错误码，由应用层映射为 HTTP 或任务错误。 */
  readonly code:
    | 'DISTILLATION_EVIDENCE_INVALID'
    | 'DISTILLATION_SOURCE_ASSESSMENT_INVALID'
    | 'DISTILLATION_CANDIDATE_NOT_EVALUATED'
    | 'DISTILLATION_EVALUATION_FAILED'
    | 'DISTILLATION_STATE_CONFLICT'

  /**
   * 创建一项不包含敏感正文的领域规则错误。
   * @param code 稳定错误码。
   * @param message 面向管理员的中文说明。
   */
  constructor(code: PersonaDistillationRuleError['code'], message: string) {
    super(message)
    this.name = 'PersonaDistillationRuleError'
    this.code = code
  }
}

/** 最终确认人物候选所需的不可变门禁事实。 */
export interface PersonaDistillationCandidateConfirmation {
  /** 运行当前状态。 */
  status: PersonaDistillationStatus
  /** 当前待确认候选正文 SHA-256。 */
  candidatePromptHash: string | null
  /** 最近一次完整通过硬门禁评测的正文 SHA-256。 */
  evaluatedPromptHash: string | null
  /** 最近一轮评测仍然存在的硬失败说明。 */
  hardFailures: string[]
}

/** 人物蒸馏资料覆盖的可审计统计。 */
export interface PersonaDistillationCoverage {
  /** 实际输入条目数。 */
  sourceCount: number
  /** 按原始来源分组后的独立来源数。 */
  independentSourceCount: number
  /** 人物本人直接来源的独立来源数。 */
  directIndependentSourceCount: number
  /** 被识别为转载、切片或重复导入的条目数。 */
  duplicateSourceCount: number
  /** 每个分析维度实际覆盖的独立来源数。 */
  dimensionIndependentSourceCounts: Record<PersonaDistillationCoverageDimension, number>
  /** 不阻止继续蒸馏的具体资料质量警告。 */
  warnings: string[]
}

/** 人物蒸馏进入灵魂综合或最终确认前的分级门禁结果。 */
export interface PersonaDistillationQualityGate {
  /** 必须修复后才能继续的确定性失败。 */
  hardFailures: string[]
  /** 允许继续但必须向用户展示的资料和推断限制。 */
  softWarnings: string[]
}

/** 能够改变人物蒸馏运行状态的领域动作。 */
export type PersonaDistillationAction =
  | 'complete_source_assessment'
  | 'confirm_sources'
  | 'complete_extraction'
  | 'complete_synthesis'
  | 'complete_evaluation'
  | 'save_candidate'
  | 'confirm_candidate'
  | 'fail'
  | 'cancel'

/** 固定主流程中的正常状态迁移。 */
const NORMAL_TRANSITIONS: Partial<Record<PersonaDistillationStatus, Partial<Record<PersonaDistillationAction, PersonaDistillationStatus>>>> = {
  assessing_sources: { complete_source_assessment: 'awaiting_source_review' },
  awaiting_source_review: { confirm_sources: 'extracting' },
  extracting: { complete_extraction: 'synthesizing' },
  synthesizing: { complete_synthesis: 'evaluating' },
  evaluating: { complete_evaluation: 'awaiting_candidate_review' },
  awaiting_candidate_review: {
    save_candidate: 'evaluating',
    confirm_candidate: 'completed',
  },
}

/** 可以响应协作式取消的全部非终态。 */
const CANCELABLE_STATUSES = new Set<PersonaDistillationStatus>([
  'assessing_sources',
  'awaiting_source_review',
  'extracting',
  'synthesizing',
  'evaluating',
  'awaiting_candidate_review',
])

/** 可以由模型、结构校验或资源错误终止的执行状态。 */
const EXECUTION_STATUSES = new Set<PersonaDistillationStatus>([
  'assessing_sources',
  'extracting',
  'synthesizing',
  'evaluating',
])

/** 能直接表达目标人物观点或语言方式的来源关系。 */
const DIRECT_SOURCE_RELATIONS = new Set<PersonaDistillationSourceRelation>([
  'subject_authored',
  'direct_conversation',
  'subject_social',
])

/** 能够直接支持人物明确陈述的来源关系。 */
const EXPLICIT_CLAIM_RELATIONS = new Set<PersonaDistillationSourceRelation>([
  'subject_authored',
  'direct_conversation',
  'subject_social',
  'user_statement',
])

/** 六类分析维度的用户可见名称。 */
const COVERAGE_DIMENSION_LABELS: Record<PersonaDistillationCoverageDimension, string> = {
  writings: '著作与系统思考',
  conversations: '长对话与即兴推理',
  expression: '表达方式',
  external_views: '他者观察与批评',
  decisions: '实际决策',
  timeline: '时间线与观点变化',
}

/**
 * 按固定人物蒸馏流程计算下一状态。
 * @param current 当前持久化状态。
 * @param action 本次已经完成领域前置校验的动作。
 * @returns 动作成功后的唯一合法状态。
 * @throws Error 当前状态不允许执行该动作时抛出错误；调用方应映射为稳定状态冲突。
 */
export function transitionPersonaDistillationStatus(
  current: PersonaDistillationStatus,
  action: PersonaDistillationAction,
): PersonaDistillationStatus {
  if (action === 'cancel' && CANCELABLE_STATUSES.has(current)) return 'canceled'
  if (action === 'fail' && EXECUTION_STATUSES.has(current)) return 'failed'
  const next = NORMAL_TRANSITIONS[current]?.[action]
  if (!next) throw new Error(`人物蒸馏状态 ${current} 不允许执行 ${action}`)
  return next
}

/**
 * 确认当前候选仍与最近通过硬门禁的评测结果完全一致。
 * @param input 运行状态、候选哈希、评测哈希和硬失败快照。
 * @returns 全部门禁通过时无返回值。
 * @throws PersonaDistillationRuleError 状态错误、评测失败或候选编辑后未重新评测时抛出。
 */
export function assertPersonaDistillationCandidateConfirmable(
  input: PersonaDistillationCandidateConfirmation,
): void {
  if (input.status !== 'awaiting_candidate_review') {
    throw new PersonaDistillationRuleError('DISTILLATION_STATE_CONFLICT', '当前人物蒸馏状态不能确认候选')
  }
  if (input.hardFailures.length > 0) {
    throw new PersonaDistillationRuleError('DISTILLATION_EVALUATION_FAILED', '人物候选仍有未通过的硬门禁评测')
  }
  if (!input.candidatePromptHash || input.candidatePromptHash !== input.evaluatedPromptHash) {
    throw new PersonaDistillationRuleError('DISTILLATION_CANDIDATE_NOT_EVALUATED', '当前人物候选尚未通过对应正文评测')
  }
}

/**
 * 按原始来源分组计算资料数量和六维覆盖，避免转载或切片虚增证据。
 * @param inputs 已固定来源关系、覆盖维度和独立来源键的运行输入。
 * @returns 不包含单一综合分数的客观覆盖统计。
 * @remarks 空独立来源键退回输入 UUID，避免不完整元数据把不同资料错误合并。
 */
export function buildPersonaDistillationCoverage(inputs: PersonaDistillationInput[]): PersonaDistillationCoverage {
  const groups = new Map<string, {
    dimensions: Set<PersonaDistillationCoverageDimension>
    direct: boolean
  }>()
  for (const input of inputs) {
    const key = input.independentSourceKey.trim() || input.id
    const group = groups.get(key) ?? { dimensions: new Set<PersonaDistillationCoverageDimension>(), direct: false }
    input.coverageDimensions.forEach(dimension => group.dimensions.add(dimension))
    group.direct ||= DIRECT_SOURCE_RELATIONS.has(input.sourceRelation)
    groups.set(key, group)
  }
  const dimensionIndependentSourceCounts = Object.fromEntries(
    PERSONA_DISTILLATION_COVERAGE_DIMENSIONS.map(dimension => [
      dimension,
      [...groups.values()].filter(group => group.dimensions.has(dimension)).length,
    ]),
  ) as Record<PersonaDistillationCoverageDimension, number>
  const directIndependentSourceCount = [...groups.values()].filter(group => group.direct).length
  const warnings: string[] = []
  if (inputs.length === 0) warnings.push('没有选择资料，人物候选只能依据用户明确要求形成。')
  if (directIndependentSourceCount === 0) warnings.push('没有人物本人直接来源，无法验证人物的自我表达。')
  for (const dimension of PERSONA_DISTILLATION_COVERAGE_DIMENSIONS) {
    if (dimensionIndependentSourceCounts[dimension] === 0) {
      warnings.push(`缺少${COVERAGE_DIMENSION_LABELS[dimension]}资料。`)
    }
  }
  return {
    sourceCount: inputs.length,
    independentSourceCount: groups.size,
    directIndependentSourceCount,
    duplicateSourceCount: inputs.length - groups.size,
    dimensionIndependentSourceCounts,
    warnings,
  }
}

/**
 * 确认模型资料分类与本次运行输入一一对应，不接受缺项或额外输入。
 * @param assessment 已通过共享 Schema 的模型资料分类结果。
 * @param inputIds 本次运行允许分类的全部输入 UUID。
 * @returns 未修改的已验证资料分类结果。
 * @throws PersonaDistillationRuleError 分类缺项、越界或重复时拒绝整个模型输出。
 */
export function validatePersonaDistillationSourceAssessment(
  assessment: ModelPersonaDistillationSourceAssessment,
  inputIds: string[],
): ModelPersonaDistillationSourceAssessment {
  const expected = new Set(inputIds)
  const actual = new Set(assessment.sources.map(source => source.inputId))
  if (expected.size !== inputIds.length || actual.size !== assessment.sources.length
    || expected.size !== actual.size || [...expected].some(id => !actual.has(id))) {
    throw new PersonaDistillationRuleError(
      'DISTILLATION_SOURCE_ASSESSMENT_INVALID',
      '人物蒸馏资料分类与本次运行输入不一致',
    )
  }
  return assessment
}

/**
 * 汇总资料覆盖和认知候选的硬失败与软警告，不生成误导性的综合分数。
 * @param coverage 已按独立来源计算的资料覆盖快照。
 * @param claims 已完成证据校验和规则分类的认知候选。
 * @returns 可以直接保存并展示的分级质量门禁。
 */
export function buildPersonaDistillationQualityGate(
  coverage: PersonaDistillationCoverage,
  claims: ValidatedPersonaDistillationClaim[],
): PersonaDistillationQualityGate {
  const usableClaims = claims.filter(claim => claim.status !== 'rejected')
  const hardFailures = usableClaims.length === 0
    ? ['没有可进入灵魂综合步骤的有效人物认知候选。']
    : []
  return {
    hardFailures,
    softWarnings: [...new Set([
      ...coverage.warnings,
      ...usableClaims.flatMap(claim => claim.warnings),
    ])],
  }
}

/**
 * 校验模型候选只能引用本次运行输入，并确认每段引文存在于固定正文。
 * @param claims 已通过共享 Zod Schema 的模型认知候选。
 * @param inputs 本次运行允许引用的不可变输入。
 * @returns 带独立来源和跨场景统计的候选。
 * @throws PersonaDistillationRuleError 引用越界或引文无法定位时拒绝整个模型输出。
 */
export function validateAndMergePersonaDistillationClaims(
  claims: ModelPersonaDistillationClaim[],
  inputs: PersonaDistillationInput[],
): ValidatedPersonaDistillationClaim[] {
  const inputsById = new Map(inputs.map(input => [input.id, input]))
  return mergePersonaDistillationClaims(claims).map((claim) => {
    const supportingSourceKeys = new Set<string>()
    const supportingDimensions = new Set<PersonaDistillationCoverageDimension>()
    const supportingRelations = new Set<PersonaDistillationSourceRelation>()
    let hasOpposingEvidence = false
    for (const evidence of claim.evidence) {
      const input = inputsById.get(evidence.inputId)
      if (!input) {
        throw new PersonaDistillationRuleError('DISTILLATION_EVIDENCE_INVALID', '人物蒸馏候选引用了本次运行以外的输入')
      }
      if (!normalizeDistillationText(input.content).includes(normalizeDistillationText(evidence.quote))) {
        throw new PersonaDistillationRuleError('DISTILLATION_EVIDENCE_INVALID', '人物蒸馏候选引文无法在固定输入中定位')
      }
      if (evidence.relation === 'supporting') {
        supportingSourceKeys.add(input.independentSourceKey.trim() || input.id)
        input.coverageDimensions.forEach(dimension => supportingDimensions.add(dimension))
        supportingRelations.add(input.sourceRelation)
      }
      else hasOpposingEvidence = true
    }
    const rejectionReasons: string[] = []
    const warnings: string[] = []
    if (supportingSourceKeys.size === 0) rejectionReasons.push('候选缺少支持证据')
    if (claim.basis === 'explicit' && ![...supportingRelations].some(relation => EXPLICIT_CLAIM_RELATIONS.has(relation))) {
      rejectionReasons.push('明确陈述缺少人物本人直接来源或用户明确设定')
    }
    if (claim.basis === 'observed' && !supportingRelations.has('observed_decision')) {
      rejectionReasons.push('观察型候选缺少实际决策证据')
    }
    if (claim.basis === 'inferred') warnings.push('该候选只由资料推断形成，不能编译为确定事实。')
    if (hasOpposingEvidence && claim.conflicts.length === 0) {
      rejectionReasons.push('存在反对证据但没有显式记录冲突')
    }
    return {
      ...claim,
      independentSourceCount: supportingSourceKeys.size,
      crossContextCount: supportingDimensions.size,
      status: rejectionReasons.length > 0 ? 'rejected' : warnings.length > 0 ? 'warning' : 'valid',
      rejectionReasons,
      warnings,
    }
  })
}

/**
 * 合并完全相同的认知候选，并对证据与冲突稳定去重。
 * @param claims 已通过共享 Schema 的模型候选。
 * @returns 保留首次正文表达、最高置信度和全部不同证据的候选。
 */
function mergePersonaDistillationClaims(claims: ModelPersonaDistillationClaim[]): ModelPersonaDistillationClaim[] {
  const merged = new Map<string, ModelPersonaDistillationClaim>()
  for (const claim of claims) {
    const key = [claim.category, claim.basis, claim.statement, claim.applicability, claim.limitations]
      .map(normalizeDistillationText)
      .join('\u0000')
    const current = merged.get(key)
    if (!current) {
      merged.set(key, { ...claim, evidence: [...claim.evidence], conflicts: [...claim.conflicts] })
      continue
    }
    const evidenceByKey = new Map(current.evidence.map(evidence => [
      `${evidence.inputId}\u0000${evidence.relation}\u0000${normalizeDistillationText(evidence.quote)}`,
      evidence,
    ]))
    for (const evidence of claim.evidence) {
      const evidenceKey = `${evidence.inputId}\u0000${evidence.relation}\u0000${normalizeDistillationText(evidence.quote)}`
      if (!evidenceByKey.has(evidenceKey)) evidenceByKey.set(evidenceKey, evidence)
    }
    current.evidence = [...evidenceByKey.values()]
    current.conflicts = [...new Set([...current.conflicts, ...claim.conflicts])]
    current.confidence = Math.max(current.confidence, claim.confidence)
  }
  return [...merged.values()]
}

/**
 * 规范化证据定位和候选去重使用的文本，不改变持久化原文。
 * @param value 待比较的候选陈述、资料正文或引文。
 * @returns 合并空白并完成中文区域小写处理的比较值。
 */
function normalizeDistillationText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN')
}
