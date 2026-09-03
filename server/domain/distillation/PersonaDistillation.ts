import type { PersonaDistillationStatus } from '../../../shared/types/personaDistillation'

/** 人物蒸馏运行允许的状态动作。 */
export type PersonaDistillationAction = 'complete_analysis' | 'save_candidate' | 'confirm_candidate' | 'cancel' | 'fail'

/** 不携带资料正文的稳定人物蒸馏领域错误。 */
export class PersonaDistillationRuleError extends Error {
  /** @param code 稳定业务错误码。 @param message 面向管理员的安全说明。 */
  constructor(
    public readonly code: 'DISTILLATION_CANDIDATE_NOT_PREPARED' | 'DISTILLATION_STATE_CONFLICT',
    message: string,
  ) {
    super(message)
  }
}

/** 人物蒸馏的唯一自动分析阶段和人工确认阶段转换。 */
const NORMAL_TRANSITIONS: Partial<Record<PersonaDistillationStatus, Partial<Record<PersonaDistillationAction, PersonaDistillationStatus>>>> = {
  analyzing: { complete_analysis: 'awaiting_candidate_review' },
  awaiting_candidate_review: { save_candidate: 'awaiting_candidate_review', confirm_candidate: 'completed' },
}

/** 每个可结束运行均允许在安全点取消。 */
const CANCELABLE_STATUSES: Partial<Record<PersonaDistillationStatus, true>> = {
  analyzing: true,
  awaiting_candidate_review: true,
}

/** 只有模型实际执行阶段可以写入失败。 */
const EXECUTION_STATUSES: Partial<Record<PersonaDistillationStatus, true>> = { analyzing: true }

/**
 * 根据运行当前状态验证并返回下一状态。
 * @param status 当前人物蒸馏状态。
 * @param action 期望执行的状态动作。
 * @returns 合法动作对应的下一状态。
 */
export function transitionPersonaDistillationStatus(
  status: PersonaDistillationStatus,
  action: PersonaDistillationAction,
): PersonaDistillationStatus {
  if (action === 'cancel') {
    if (CANCELABLE_STATUSES[status]) return 'canceled'
    throw new PersonaDistillationRuleError('DISTILLATION_STATE_CONFLICT', '当前人物蒸馏状态不能取消')
  }
  if (action === 'fail') {
    if (EXECUTION_STATUSES[status]) return 'failed'
    throw new PersonaDistillationRuleError('DISTILLATION_STATE_CONFLICT', '当前人物蒸馏状态不允许执行失败')
  }
  const next = NORMAL_TRANSITIONS[status]?.[action]
  if (next) return next
  throw new PersonaDistillationRuleError('DISTILLATION_STATE_CONFLICT', '当前人物蒸馏状态不允许执行此操作')
}

/**
 * 确认候选已经由本次自由分析或人工编辑准备就绪。
 * @param input 当前状态与正文哈希。
 * @returns 校验通过时结束。
 */
export function assertPersonaDistillationCandidateConfirmable(input: {
  status: PersonaDistillationStatus
  candidatePromptHash: string | null
  preparedPromptHash: string | null
}): void {
  if (input.status !== 'awaiting_candidate_review') {
    throw new PersonaDistillationRuleError('DISTILLATION_STATE_CONFLICT', '当前人物蒸馏状态不能确认候选')
  }
  if (!input.candidatePromptHash || input.candidatePromptHash !== input.preparedPromptHash) {
    throw new PersonaDistillationRuleError('DISTILLATION_CANDIDATE_NOT_PREPARED', '当前人物候选尚未准备完成')
  }
}
