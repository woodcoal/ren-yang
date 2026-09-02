import { describe, expect, it } from 'vitest'
import {
  confirmPersonaDistillationCandidateSchema,
  createPersonaDistillationSchema,
  modelPersonaDistillationExtractionSchema,
  modelPersonaDistillationSourceAssessmentSchema,
  reviewPersonaDistillationSourcesSchema,
  savePersonaDistillationCandidateSchema,
} from '../../shared/schemas/personaDistillation'
import type { ModelPersonaDistillationClaim } from '../../shared/schemas/personaDistillation'
import type { ModelPersonaDistillationSourceAssessment } from '../../shared/schemas/personaDistillation'
import { PERSONA_DISTILLATION_ALGORITHM_STEPS } from '../../shared/types/personaDistillation'
import {
  assertPersonaDistillationCandidateConfirmable,
  buildPersonaDistillationCoverage,
  buildPersonaDistillationQualityGate,
  transitionPersonaDistillationStatus,
  validatePersonaDistillationSourceAssessment,
  validateAndMergePersonaDistillationClaims,
} from '../../server/domain/distillation/PersonaDistillation'

/**
 * 创建一项结构完整的人物蒸馏候选，允许单元测试只覆盖关心的规则。
 * @param overrides 需要替换的候选字段。
 * @returns 可直接传给纯领域校验接口的模型候选。
 */
function distillationClaim(overrides: Partial<ModelPersonaDistillationClaim> = {}): ModelPersonaDistillationClaim {
  return {
    category: 'mental_model',
    statement: '先验证来源再下结论。',
    applicability: '事实判断',
    limitations: '紧急情况下可能先采取可逆行动。',
    basis: 'explicit',
    confidence: 0.9,
    evidence: [{
      inputId: '10000000-0000-4000-8000-000000000001',
      relation: 'supporting',
      quote: '先验证来源',
    }],
    conflicts: [],
    ...overrides,
  }
}

describe('人物蒸馏状态机', () => {
  it('按固定步骤从资料评估推进到候选审核', () => {
    expect(transitionPersonaDistillationStatus('assessing_sources', 'complete_source_assessment'))
      .toBe('awaiting_source_review')
    expect(transitionPersonaDistillationStatus('awaiting_source_review', 'confirm_sources'))
      .toBe('extracting')
    expect(transitionPersonaDistillationStatus('extracting', 'complete_extraction'))
      .toBe('synthesizing')
    expect(transitionPersonaDistillationStatus('synthesizing', 'complete_synthesis'))
      .toBe('evaluating')
    expect(transitionPersonaDistillationStatus('evaluating', 'complete_evaluation'))
      .toBe('awaiting_candidate_review')
  })

  it('允许全部非终态在安全点取消，并只允许模型执行阶段失败', () => {
    const cancelable = [
      'assessing_sources',
      'awaiting_source_review',
      'extracting',
      'synthesizing',
      'evaluating',
      'awaiting_candidate_review',
    ] as const

    expect(cancelable.map(status => transitionPersonaDistillationStatus(status, 'cancel')))
      .toEqual(cancelable.map(() => 'canceled'))
    expect(transitionPersonaDistillationStatus('extracting', 'fail')).toBe('failed')
    expect(() => transitionPersonaDistillationStatus('awaiting_source_review', 'fail')).toThrow('不允许执行')
  })

  it('候选编辑后回到评测，只有待审核候选才能完成创建', () => {
    expect(transitionPersonaDistillationStatus('awaiting_candidate_review', 'save_candidate')).toBe('evaluating')
    expect(transitionPersonaDistillationStatus('awaiting_candidate_review', 'confirm_candidate')).toBe('completed')
    expect(() => transitionPersonaDistillationStatus('evaluating', 'confirm_candidate')).toThrow('不允许执行')
  })
})

describe('人物蒸馏共享契约', () => {
  it('固定四个模型步骤及其执行顺序', () => {
    expect(PERSONA_DISTILLATION_ALGORITHM_STEPS).toEqual([
      'classify_sources',
      'extract_claims',
      'synthesize_soul',
      'evaluate_soul',
    ])
  })

  it('允许只用自然语言要求创建无资料蒸馏运行', () => {
    expect(createPersonaDistillationSchema.parse({
      requestedName: '  顾岚  ',
      objective: '  提炼谨慎且重视证据的判断方式。  ',
      worldId: null,
      sourceIds: [],
    })).toEqual({
      requestedName: '顾岚',
      objective: '提炼谨慎且重视证据的判断方式。',
      worldId: null,
      sourceIds: [],
    })
  })

  it('推断型候选必须说明局限并引用可定位证据', () => {
    const candidate = {
      claims: [{
        category: 'mental_model',
        statement: '倾向先验证来源再下结论。',
        applicability: '资料判断',
        limitations: '',
        basis: 'inferred',
        confidence: 0.8,
        evidence: [{
          inputId: '10000000-0000-4000-8000-000000000001',
          relation: 'supporting',
          quote: '先验证来源',
        }],
        conflicts: [],
      }],
    }

    expect(modelPersonaDistillationExtractionSchema.safeParse(candidate).success).toBe(false)
  })

  it('资料审核和候选确认使用固定枚举、并发时间与 SHA-256', () => {
    expect(reviewPersonaDistillationSourcesSchema.parse({
      expectedUpdatedAt: 1_788_480_000_000,
      acceptedInputIds: [],
      corrections: [],
    })).toMatchObject({ acceptedInputIds: [], corrections: [] })
    expect(savePersonaDistillationCandidateSchema.parse({
      expectedUpdatedAt: 1_788_480_000_000,
      promptText: '  # 心智模型\n先验证来源。  ',
    }).promptText).toBe('# 心智模型\n先验证来源。')
    expect(confirmPersonaDistillationCandidateSchema.safeParse({
      expectedUpdatedAt: 1_788_480_000_000,
      name: '顾岚',
      expectedPromptHash: 'a'.repeat(63),
    }).success).toBe(false)
    expect(modelPersonaDistillationSourceAssessmentSchema.safeParse({
      sources: [{
        inputId: '10000000-0000-4000-8000-000000000001',
        sourceRelation: 'subject_authored',
        coverageDimensions: ['writings', 'writings'],
        independentSourceKey: 'book-one',
      }],
    }).success).toBe(false)
    expect(modelPersonaDistillationSourceAssessmentSchema.safeParse({
      sources: [{
        inputId: '10000000-0000-4000-8000-000000000001',
        sourceRelation: 'user_statement',
        coverageDimensions: [],
        independentSourceKey: 'request',
      }],
    }).success).toBe(false)
  })
})

describe('人物蒸馏资料覆盖', () => {
  it('资料分类必须与运行输入一一对应', () => {
    const inputIds = [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
    ]
    const assessment: ModelPersonaDistillationSourceAssessment = {
      sources: [{
        inputId: inputIds[0],
        sourceRelation: 'subject_authored',
        coverageDimensions: ['writings'],
        independentSourceKey: 'book-one',
      }],
    }

    expect(() => validatePersonaDistillationSourceAssessment(assessment, inputIds))
      .toThrowError(expect.objectContaining({ code: 'DISTILLATION_SOURCE_ASSESSMENT_INVALID' }))
    expect(() => validatePersonaDistillationSourceAssessment({
      sources: [...assessment.sources, {
        inputId: '20000000-0000-4000-8000-000000000003',
        sourceRelation: 'third_party',
        coverageDimensions: ['external_views'],
        independentSourceKey: 'profile-one',
      }],
    }, [inputIds[0]])).toThrowError(expect.objectContaining({ code: 'DISTILLATION_SOURCE_ASSESSMENT_INVALID' }))
  })

  it('转载和切片按原始来源分组，不会虚增独立来源与维度覆盖', () => {
    const coverage = buildPersonaDistillationCoverage([
      {
        id: '10000000-0000-4000-8000-000000000001',
        sourceRelation: 'direct_conversation',
        coverageDimensions: ['conversations', 'expression'],
        independentSourceKey: 'interview-2026',
        content: '完整访谈上半段。',
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        sourceRelation: 'direct_conversation',
        coverageDimensions: ['conversations'],
        independentSourceKey: 'interview-2026',
        content: '同一访谈下半段。',
      },
      {
        id: '10000000-0000-4000-8000-000000000003',
        sourceRelation: 'third_party',
        coverageDimensions: ['external_views'],
        independentSourceKey: 'profile-2025',
        content: '第三方人物报道。',
      },
    ])

    expect(coverage).toMatchObject({
      sourceCount: 3,
      independentSourceCount: 2,
      directIndependentSourceCount: 1,
      duplicateSourceCount: 1,
      dimensionIndependentSourceCounts: {
        writings: 0,
        conversations: 1,
        expression: 1,
        external_views: 1,
        decisions: 0,
        timeline: 0,
      },
    })
  })

  it('资料不足只形成具体软警告，不阻止无资料人物继续蒸馏', () => {
    expect(buildPersonaDistillationCoverage([]).warnings).toEqual([
      '没有选择资料，人物候选只能依据用户明确要求形成。',
      '没有人物本人直接来源，无法验证人物的自我表达。',
      '缺少著作与系统思考资料。',
      '缺少长对话与即兴推理资料。',
      '缺少表达方式资料。',
      '缺少他者观察与批评资料。',
      '缺少实际决策资料。',
      '缺少时间线与观点变化资料。',
    ])
  })
})

describe('人物蒸馏证据校验', () => {
  it('拒绝引用本次运行以外的输入或无法在固定正文中定位的引文', () => {
    const input = {
      id: '10000000-0000-4000-8000-000000000001',
      sourceRelation: 'subject_authored' as const,
      coverageDimensions: ['writings'] as const,
      independentSourceKey: 'book-one',
      content: '做判断之前，先验证信息来源。',
    }
    const baseClaim = {
      category: 'mental_model' as const,
      statement: '先验证来源再下结论。',
      applicability: '资料判断',
      limitations: '紧急情况下可能先采取可逆行动。',
      basis: 'explicit' as const,
      confidence: 0.9,
      evidence: [{
        inputId: input.id,
        relation: 'supporting' as const,
        quote: '先验证信息来源',
      }],
      conflicts: [],
    }

    expect(() => validateAndMergePersonaDistillationClaims([
      { ...baseClaim, evidence: [{ ...baseClaim.evidence[0], inputId: '20000000-0000-4000-8000-000000000002' }] },
    ], [input])).toThrowError(expect.objectContaining({ code: 'DISTILLATION_EVIDENCE_INVALID' }))
    expect(() => validateAndMergePersonaDistillationClaims([
      { ...baseClaim, evidence: [{ ...baseClaim.evidence[0], quote: '正文中不存在的引文' }] },
    ], [input])).toThrowError(expect.objectContaining({ code: 'DISTILLATION_EVIDENCE_INVALID' }))
  })

  it('合并相同候选并按原始来源计算证据强度，同时保留冲突', () => {
    const inputs = [
      {
        id: '10000000-0000-4000-8000-000000000001',
        sourceRelation: 'direct_conversation' as const,
        coverageDimensions: ['conversations', 'expression'] as const,
        independentSourceKey: 'interview-one',
        content: '先验证来源，再给出判断。',
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        sourceRelation: 'direct_conversation' as const,
        coverageDimensions: ['conversations'] as const,
        independentSourceKey: 'interview-one',
        content: '面对新问题仍然先核对来源。',
      },
      {
        id: '10000000-0000-4000-8000-000000000003',
        sourceRelation: 'subject_authored' as const,
        coverageDimensions: ['writings'] as const,
        independentSourceKey: 'book-one',
        content: '可逆决策可以先行动，但事实判断必须核对来源。',
      },
    ]
    const shared = {
      category: 'mental_model' as const,
      applicability: '事实判断',
      limitations: '可逆且紧急的行动不必等待全部信息。',
      basis: 'explicit' as const,
    }
    const claims = [
      {
        ...shared,
        statement: '先验证来源再下结论。',
        confidence: 0.7,
        evidence: [{ inputId: inputs[0].id, relation: 'supporting' as const, quote: '先验证来源' }],
        conflicts: ['行动速度与验证深度存在张力'],
      },
      {
        ...shared,
        statement: '  先验证来源再下结论。 ',
        confidence: 0.9,
        evidence: [
          { inputId: inputs[1].id, relation: 'supporting' as const, quote: '先核对来源' },
          { inputId: inputs[2].id, relation: 'supporting' as const, quote: '事实判断必须核对来源' },
        ],
        conflicts: ['行动速度与验证深度存在张力', '紧急场景边界待确认'],
      },
    ]

    expect(validateAndMergePersonaDistillationClaims(claims, inputs)).toEqual([{
      ...claims[0],
      confidence: 0.9,
      evidence: [...claims[0].evidence, ...claims[1].evidence],
      conflicts: ['行动速度与验证深度存在张力', '紧急场景边界待确认'],
      independentSourceCount: 2,
      crossContextCount: 3,
      status: 'valid',
      rejectionReasons: [],
      warnings: [],
    }])
  })

  it('按来源关系拒绝伪装成明确或观察事实的候选，并保留推断警告', () => {
    const directInput = {
      id: '10000000-0000-4000-8000-000000000001',
      sourceRelation: 'subject_authored' as const,
      coverageDimensions: ['writings'] as const,
      independentSourceKey: 'book-one',
      content: '先验证来源再下结论。',
    }
    const thirdPartyInput = {
      id: '20000000-0000-4000-8000-000000000002',
      sourceRelation: 'third_party' as const,
      coverageDimensions: ['external_views'] as const,
      independentSourceKey: 'profile-one',
      content: '评论者认为他通常会先核对来源。',
    }
    const claims = [
      distillationClaim({
        evidence: [{ inputId: thirdPartyInput.id, relation: 'supporting', quote: '先核对来源' }],
      }),
      distillationClaim({
        basis: 'observed',
        evidence: [{ inputId: directInput.id, relation: 'supporting', quote: '先验证来源' }],
      }),
      distillationClaim({
        basis: 'inferred',
        evidence: [{ inputId: thirdPartyInput.id, relation: 'supporting', quote: '先核对来源' }],
      }),
    ]

    const result = validateAndMergePersonaDistillationClaims(claims, [directInput, thirdPartyInput])
    expect(result.map(item => item.status)).toEqual(['rejected', 'rejected', 'warning'])
    expect(result[0]?.rejectionReasons).toContain('明确陈述缺少人物本人直接来源或用户明确设定')
    expect(result[1]?.rejectionReasons).toContain('观察型候选缺少实际决策证据')
    expect(result[2]?.warnings).toEqual(['该候选只由资料推断形成，不能编译为确定事实。'])
  })

  it('反对证据存在时必须显式记录冲突', () => {
    const input = {
      id: '10000000-0000-4000-8000-000000000001',
      sourceRelation: 'subject_authored' as const,
      coverageDimensions: ['writings'] as const,
      independentSourceKey: 'book-one',
      content: '早期主张先行动，后来强调先验证来源。',
    }
    const claim = distillationClaim({
      evidence: [
        { inputId: input.id, relation: 'supporting', quote: '先验证来源' },
        { inputId: input.id, relation: 'opposing', quote: '先行动' },
      ],
      conflicts: [],
    })

    expect(validateAndMergePersonaDistillationClaims([claim], [input])[0]).toMatchObject({
      status: 'rejected',
      rejectionReasons: ['存在反对证据但没有显式记录冲突'],
    })
  })
})

describe('人物蒸馏候选确认', () => {
  it('候选正文必须与最近通过硬门禁的评测哈希一致', () => {
    expect(() => assertPersonaDistillationCandidateConfirmable({
      status: 'awaiting_candidate_review',
      candidatePromptHash: 'a'.repeat(64),
      evaluatedPromptHash: 'b'.repeat(64),
      hardFailures: [],
    })).toThrowError(expect.objectContaining({ code: 'DISTILLATION_CANDIDATE_NOT_EVALUATED' }))

    expect(() => assertPersonaDistillationCandidateConfirmable({
      status: 'awaiting_candidate_review',
      candidatePromptHash: 'a'.repeat(64),
      evaluatedPromptHash: 'a'.repeat(64),
      hardFailures: [],
    })).not.toThrow()
  })

  it('无可用候选形成硬失败，资料缺口和推断只形成具体软警告', () => {
    const coverage = buildPersonaDistillationCoverage([])
    const rejected = {
      ...distillationClaim(),
      independentSourceCount: 0,
      crossContextCount: 0,
      status: 'rejected' as const,
      rejectionReasons: ['明确陈述缺少人物本人直接来源或用户明确设定'],
      warnings: [],
    }
    expect(buildPersonaDistillationQualityGate(coverage, [rejected])).toMatchObject({
      hardFailures: ['没有可进入灵魂综合步骤的有效人物认知候选。'],
      softWarnings: coverage.warnings,
    })
  })
})
