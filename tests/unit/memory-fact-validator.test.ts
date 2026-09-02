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
    evidence: [{ inputId: EXTERNAL_ONE }],
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
        { inputId: EXTERNAL_ONE },
        { inputId: EXTERNAL_TWO },
      ],
    })
    expect(validateAndMergeMemoryFacts([fact], externalInputs(EXTERNAL_ONE, EXTERNAL_TWO))[0])
      .toMatchObject({ memoryType: 'preference', independentEvidenceCount: 2 })
  })

  it('单条普通证据不能形成偏好记忆', () => {
    const fact = candidate({ memoryType: 'preference' })
    expect(validateAndMergeMemoryFacts([fact], externalInputs(EXTERNAL_ONE))).toEqual([])
  })

  it('三条独立证据可以形成判断记忆', () => {
    const fact = candidate({
      statement: '判断人物关系一致性比辞藻丰富更重要。',
      memoryType: 'judgment',
      evidence: [EXTERNAL_ONE, EXTERNAL_TWO, EXTERNAL_THREE]
        .map(inputId => ({ inputId })),
    })
    expect(validateAndMergeMemoryFacts([fact], externalInputs(EXTERNAL_ONE, EXTERNAL_TWO, EXTERNAL_THREE))[0])
      .toMatchObject({ memoryType: 'judgment', independentEvidenceCount: 3 })
  })

  it('任务记录的信号由程序固定派生为任务结果', () => {
    const fact = candidate({
      memoryType: 'experience',
      evidence: [{ inputId: OPERATION_ONE }],
    })
    expect(validateAndMergeMemoryFacts([fact], [{ id: OPERATION_ONE, inputType: 'persona_operation_record' }])[0])
      .toMatchObject({ independentEvidenceCount: 1, evidence: [{ inputId: OPERATION_ONE, signalType: 'task_result' }] })
  })

  it('引用当前批次不存在的输入时拒绝整个模型结果', () => {
    expect(() => validateAndMergeMemoryFacts([candidate()], []))
      .toThrowError(expect.objectContaining({ code: 'MODEL_OUTPUT_INVALID' }))
  })

  it('不支持的批次输入类型不能被模型引用', () => {
    const fact = candidate({ evidence: [{ inputId: OPERATION_ONE }] })
    expect(() => validateAndMergeMemoryFacts([fact], [{ id: OPERATION_ONE, inputType: 'growth_material' }]))
      .toThrowError(expect.objectContaining({ code: 'MODEL_OUTPUT_INVALID' }))
  })

  it('完全相同陈述会合并证据、置信度和冲突说明', () => {
    const facts = [
      candidate({ memoryType: 'interest', confidence: 0.6, conflicts: ['适用范围待确认'] }),
      candidate({
        statement: '  完成过一次小说人物关系校对。 ',
        memoryType: 'interest',
        evidence: [
          { inputId: EXTERNAL_ONE },
          { inputId: EXTERNAL_TWO },
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
