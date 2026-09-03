import { describe, expect, it } from 'vitest'
import {
  confirmPersonaDistillationCandidateSchema,
  createPersonaDistillationSchema,
  savePersonaDistillationCandidateSchema,
} from '../../shared/schemas/personaDistillation'
import { PERSONA_DISTILLATION_ALGORITHM_STEPS } from '../../shared/types/personaDistillation'
import { getAiAlgorithmDefinition } from '../../server/domain/ai/AiAlgorithmDefinitions'
import {
  assertPersonaDistillationCandidateConfirmable,
  transitionPersonaDistillationStatus,
} from '../../server/domain/distillation/PersonaDistillation'

/** 人物自由蒸馏共享契约和状态机。 */
describe('人物自由蒸馏', () => {
  it('内部保留自由分析和灵魂编写两段，但不暴露结构化结果契约', () => {
    expect(PERSONA_DISTILLATION_ALGORITHM_STEPS).toEqual(['analyze', 'compose'])
    expect(getAiAlgorithmDefinition('persona_distillation').steps).toEqual([
      expect.objectContaining({ key: 'analyze', promptCode: 'distillation.analyze_persona', ordinal: 0 }),
      expect.objectContaining({ key: 'compose', promptCode: 'distillation.compose_soul', ordinal: 1 }),
    ])
  })

  it('从分析推进到人工确认，人工校准不再触发第二次模型阶段', () => {
    expect(transitionPersonaDistillationStatus('analyzing', 'complete_analysis')).toBe('awaiting_candidate_review')
    expect(transitionPersonaDistillationStatus('awaiting_candidate_review', 'save_candidate')).toBe('awaiting_candidate_review')
    expect(transitionPersonaDistillationStatus('awaiting_candidate_review', 'confirm_candidate')).toBe('completed')
    expect(transitionPersonaDistillationStatus('analyzing', 'cancel')).toBe('canceled')
    expect(transitionPersonaDistillationStatus('analyzing', 'fail')).toBe('failed')
  })


  it('创建、校准和确认仍使用边界输入校验与候选哈希', () => {
    expect(createPersonaDistillationSchema.parse({
      requestedName: ' 顾岚 ', objective: ' 提炼判断方式。 ', worldId: null, sourceIds: [],
    })).toMatchObject({ requestedName: '顾岚', objective: '提炼判断方式。' })
    expect(savePersonaDistillationCandidateSchema.parse({
      expectedUpdatedAt: 1_788_480_000_000, promptText: ' 候选灵魂 ',
    }).promptText).toBe('候选灵魂')
    expect(confirmPersonaDistillationCandidateSchema.safeParse({
      expectedUpdatedAt: 1_788_480_000_000, name: '顾岚', expectedPromptHash: 'a'.repeat(63),
    }).success).toBe(false)
  })

  it('只允许准备好的候选进入最终确认', () => {
    expect(() => assertPersonaDistillationCandidateConfirmable({
      status: 'awaiting_candidate_review', candidatePromptHash: 'a'.repeat(64), preparedPromptHash: 'b'.repeat(64),
    })).toThrow('尚未准备完成')
    expect(() => assertPersonaDistillationCandidateConfirmable({
      status: 'awaiting_candidate_review', candidatePromptHash: 'a'.repeat(64), preparedPromptHash: 'a'.repeat(64),
    })).not.toThrow()
  })
})
