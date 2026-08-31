import { describe, expect, it } from 'vitest'
import {
  validateAndMergeMemoryFacts,
  type MemoryFactCandidate,
  type MemoryFactInput,
} from '../../server/application/analysis/MemoryFactValidator'

const EXTERNAL_ONE = '10000000-0000-4000-8000-000000000001'
const EXTERNAL_TWO = '10000000-0000-4000-8000-000000000002'
const EXTERNAL_THREE = '10000000-0000-4000-8000-000000000003'
const OPERATION_ONE = '20000000-0000-4000-8000-000000000001'

/** 创建一项结构完整的人物记忆候选，允许测试只覆盖关心的字段。 */
function candidate(overrides: Partial<MemoryFactCandidate> = {}): MemoryFactCandidate {
  return {
    statement: '完成过一次小说人物关系校对。',
    memoryType: 'experience',
    evidence: [{ inputId: EXTERNAL_ONE, signalType: 'external_record' }],
    confidence: 0.8,
    conflicts: [],
    ...overrides,
  }
}

/** 创建指定数量的第三方经历输入。 */
function externalInputs(...ids: string[]): MemoryFactInput[] {
  return ids.map(id => ({ id, inputType: 'persona_external_record' }))
}

describe('人物记忆证据校验与形成门槛', () => {
  it('单条有效第三方经历可以形成经验记忆', () => {
    expect(validateAndMergeMemoryFacts([candidate()], externalInputs(EXTERNAL_ONE))).toEqual([
      expect.objectContaining({ memoryType: 'experience', independentEvidenceCount: 1 }),
    ])
  })

  it('两条独立证据可以形成偏好记忆', () => {
    const fact = candidate({
      statement: '偏好先核对人物关系再润色文本。',
      memoryType: 'preference',
      evidence: [
        { inputId: EXTERNAL_ONE, signalType: 'external_record' },
        { inputId: EXTERNAL_TWO, signalType: 'external_record' },
      ],
    })
    expect(validateAndMergeMemoryFacts([fact], externalInputs(EXTERNAL_ONE, EXTERNAL_TWO))[0])
      .toMatchObject({ memoryType: 'preference', independentEvidenceCount: 2 })
  })

  it('单条普通证据不能形成偏好记忆', () => {
    const fact = candidate({ memoryType: 'preference' })
    expect(() => validateAndMergeMemoryFacts([fact], externalInputs(EXTERNAL_ONE)))
      .toThrowError(expect.objectContaining({ code: 'MEMORY_EVIDENCE_INSUFFICIENT' }))
  })

  it('三条独立证据可以形成判断记忆', () => {
    const fact = candidate({
      statement: '判断人物关系一致性比辞藻丰富更重要。',
      memoryType: 'judgment',
      evidence: [EXTERNAL_ONE, EXTERNAL_TWO, EXTERNAL_THREE]
        .map(inputId => ({ inputId, signalType: 'external_record' as const })),
    })
    expect(validateAndMergeMemoryFacts([fact], externalInputs(EXTERNAL_ONE, EXTERNAL_TWO, EXTERNAL_THREE))[0])
      .toMatchObject({ memoryType: 'judgment', independentEvidenceCount: 3 })
  })

  it('人物自己的模型输出不计入独立证据', () => {
    const fact = candidate({
      memoryType: 'experience',
      evidence: [{ inputId: OPERATION_ONE, signalType: 'self_output' }],
    })
    expect(() => validateAndMergeMemoryFacts([fact], [{ id: OPERATION_ONE, inputType: 'persona_operation_record' }]))
      .toThrowError(expect.objectContaining({ code: 'MEMORY_EVIDENCE_INSUFFICIENT' }))
  })

  it('明确用户反馈单条即可形成任意类型记忆', () => {
    const fact = candidate({
      memoryType: 'judgment',
      evidence: [{ inputId: OPERATION_ONE, signalType: 'user_feedback' }],
    })
    expect(validateAndMergeMemoryFacts([fact], [{ id: OPERATION_ONE, inputType: 'persona_operation_record' }])[0])
      .toMatchObject({ memoryType: 'judgment', independentEvidenceCount: 1 })
  })

  it('同一任务记录含多种信号时只计一次并优先保留明确用户反馈', () => {
    const fact = candidate({
      memoryType: 'judgment',
      evidence: [
        { inputId: OPERATION_ONE, signalType: 'user_feedback' },
        { inputId: OPERATION_ONE, signalType: 'task_result' },
      ],
    })
    expect(validateAndMergeMemoryFacts([fact], [{ id: OPERATION_ONE, inputType: 'persona_operation_record' }])[0])
      .toMatchObject({ independentEvidenceCount: 1, evidence: [{ inputId: OPERATION_ONE, signalType: 'user_feedback' }] })
  })

  it('引用当前批次不存在的输入时拒绝整个模型结果', () => {
    expect(() => validateAndMergeMemoryFacts([candidate()], []))
      .toThrowError(expect.objectContaining({ code: 'MODEL_OUTPUT_INVALID' }))
  })

  it('第三方经历和任务记录的信号类型不匹配时拒绝整个模型结果', () => {
    const fact = candidate({ evidence: [{ inputId: OPERATION_ONE, signalType: 'external_record' }] })
    expect(() => validateAndMergeMemoryFacts([fact], [{ id: OPERATION_ONE, inputType: 'persona_operation_record' }]))
      .toThrowError(expect.objectContaining({ code: 'MODEL_OUTPUT_INVALID' }))
  })

  it('完全相同陈述会合并证据、置信度和冲突说明', () => {
    const facts = [
      candidate({ memoryType: 'interest', confidence: 0.6, conflicts: ['适用范围待确认'] }),
      candidate({
        statement: '  完成过一次小说人物关系校对。 ',
        memoryType: 'interest',
        evidence: [
          { inputId: EXTERNAL_ONE, signalType: 'external_record' },
          { inputId: EXTERNAL_TWO, signalType: 'external_record' },
        ],
        confidence: 0.9,
        conflicts: ['适用范围待确认', '题材偏差待确认'],
      }),
    ]
    expect(validateAndMergeMemoryFacts(facts, externalInputs(EXTERNAL_ONE, EXTERNAL_TWO))).toEqual([{
      statement: '完成过一次小说人物关系校对。',
      memoryType: 'interest',
      evidence: [
        { inputId: EXTERNAL_ONE, signalType: 'external_record' },
        { inputId: EXTERNAL_TWO, signalType: 'external_record' },
      ],
      independentEvidenceCount: 2,
      confidence: 0.9,
      conflicts: ['适用范围待确认', '题材偏差待确认'],
    }])
  })
})
