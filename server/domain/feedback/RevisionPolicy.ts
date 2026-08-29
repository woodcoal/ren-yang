import type { PersonaSnapshot } from '../../../shared/types/content'

/** 人物快照中允许由修订提案修改的稳定字段。 */
export type PersonaRevisionField = keyof PersonaSnapshot

/** 用户确认后的字段级人物修订。 */
export interface PersonaRevisionPatch {
  /** 目标人物快照字段。 */
  field: PersonaRevisionField
  /** 修订后的完整字段值。 */
  after: string
  /** 支持本次变化的简短理由。 */
  reason: string
}

/** 修订提案使用的三档风险。 */
export type RevisionRiskLevel = 'low' | 'high' | 'critical'

/** 领域风险判定结果。 */
export interface RevisionRiskAssessment {
  /** 最高字段风险。 */
  riskLevel: RevisionRiskLevel
  /** 是否满足进入自动发布门禁的字段条件。 */
  autoPublishEligible: boolean
  /** 面向审查者的确定性判定依据。 */
  reasons: string[]
}

/** 发布决策需要的全部门禁事实。 */
export interface RevisionPublicationFacts {
  /** 提案的字段风险。 */
  riskLevel: RevisionRiskLevel
  /** 最近一次完整评测结论。 */
  evaluationStatus: 'not_run' | 'passed' | 'failed'
  /** 提案基础版本当前是否仍是人物活动版本。 */
  baseVersionIsActive: boolean
  /** 支持或反对证据中是否存在未解决冲突。 */
  hasEvidenceConflict: boolean
  /** 管理员是否启用低风险自动发布。 */
  autoPublishEnabled: boolean
  /** 当前调用是否包含明确人工确认。 */
  manualConfirmation: boolean
}

/** 发布门禁的确定性结果。 */
export interface RevisionPublicationDecision {
  /** 自动发布、等待人工确认或禁止发布。 */
  action: 'auto_publish' | 'manual_publish' | 'manual_required' | 'blocked'
  /** 面向用户的稳定原因。 */
  reason: string
}

/** 可在严格条件下视为小幅追加的低风险字段。 */
const LOW_RISK_APPEND_FIELDS = new Set<PersonaRevisionField>(['expressionStyle', 'interests'])

/** 修改后始终需要人工确认的高风险字段。 */
const HIGH_RISK_FIELDS = new Set<PersonaRevisionField>([
  'summary',
  'identityFacts',
  'valuesAndMotivations',
  'appearance',
  'visualStyle',
])

/**
 * 按字段和变化形态确定人物修订风险，不使用模型评分代替硬规则。
 * @param baseSnapshot 提案所基于的不可变人物快照。
 * @param patches 用户确认后的字段级补丁；每个字段最多出现一次。
 * @returns 风险等级、自动发布字段资格和可审计原因。
 * @throws Error 补丁为空、字段重复、理由为空或没有实际变化时抛出。
 */
export function assessRevisionRisk(
  baseSnapshot: PersonaSnapshot,
  patches: PersonaRevisionPatch[],
): RevisionRiskAssessment {
  if (patches.length === 0) throw new Error('修订提案至少需要一个字段补丁')

  const fields = new Set<PersonaRevisionField>()
  let riskLevel: RevisionRiskLevel = 'low'
  const reasons: string[] = []

  for (const patch of patches) {
    if (fields.has(patch.field)) throw new Error(`修订补丁字段重复：${patch.field}`)
    fields.add(patch.field)
    if (!patch.reason.trim()) throw new Error('修订补丁理由不能为空')

    const before = baseSnapshot[patch.field]
    const after = patch.after.trim()
    if (before === after) throw new Error('修订补丁必须产生实际变化')

    if (patch.field === 'constraints') {
      riskLevel = 'critical'
      reasons.push('约束和安全边界变化属于最高风险')
      continue
    }

    if (HIGH_RISK_FIELDS.has(patch.field)) {
      if (riskLevel !== 'critical') riskLevel = 'high'
      reasons.push(`${patch.field} 属于人物事实或稳定核心字段`)
      continue
    }

    // 字符串快照无法可靠衡量语义距离，因此低风险只接受保留全部原文的有限追加。
    const appendedLength = after.length - before.length
    const isSmallAppend = LOW_RISK_APPEND_FIELDS.has(patch.field)
      && after.startsWith(before)
      && appendedLength > 0
      && appendedLength <= 500
    if (!isSmallAppend) {
      if (riskLevel !== 'critical') riskLevel = 'high'
      reasons.push(`${patch.field} 不是保留原文且不超过 500 字的小幅追加`)
    }
    else {
      reasons.push(`${patch.field} 是保留原文的小幅追加`)
    }
  }

  if (patches.length > 1 && riskLevel !== 'critical') {
    riskLevel = 'high'
    reasons.push('一次修改多个长期人物字段必须人工确认')
  }

  return {
    riskLevel,
    autoPublishEligible: riskLevel === 'low' && patches.length === 1,
    reasons,
  }
}

/**
 * 根据评测、版本并发、证据冲突和人工确认事实决定发布行为。
 * @param facts 已从事实源读取的完整门禁条件。
 * @returns 不执行副作用的发布决策。
 */
export function decideRevisionPublication(facts: RevisionPublicationFacts): RevisionPublicationDecision {
  if (!facts.baseVersionIsActive) {
    return { action: 'blocked', reason: '提案基础版本已不是当前人物版本，请基于当前版本重新建立提案' }
  }
  if (facts.evaluationStatus !== 'passed') {
    return { action: 'blocked', reason: facts.evaluationStatus === 'failed' ? '最近一次评测未通过' : '提案尚未完成评测' }
  }
  if (facts.hasEvidenceConflict) {
    return { action: 'blocked', reason: '提案存在未解决的证据冲突' }
  }
  if (facts.riskLevel !== 'low') {
    return facts.manualConfirmation
      ? { action: 'manual_publish', reason: '高风险提案已通过评测并获得明确人工确认' }
      : { action: 'manual_required', reason: '高风险或最高风险提案必须人工确认' }
  }
  if (facts.manualConfirmation) {
    return { action: 'manual_publish', reason: '低风险提案已通过评测并获得明确人工确认' }
  }
  if (!facts.autoPublishEnabled) {
    return { action: 'manual_required', reason: '低风险自动发布设置未启用' }
  }
  return { action: 'auto_publish', reason: '低风险提案已通过评测和全部自动发布门禁' }
}
