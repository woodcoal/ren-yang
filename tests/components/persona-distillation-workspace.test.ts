import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { PersonaDistillationRunView } from '#shared/types/personaDistillation'
import CoverageReview from '../../app/components/distillation/CoverageReview.vue'
import CandidateReview from '../../app/components/distillation/CandidateReview.vue'
import PersonaDistillationPage from '../../app/pages/personas/distillations/[id].vue'

const RUN_ID = '30000000-0000-4000-8000-000000000001'
const CANDIDATE_HASH = 'a'.repeat(64)

/**
 * 创建覆盖两个检查点所需的稳定人物蒸馏运行视图。
 * @param overrides 当前测试需要覆盖的运行字段。
 * @returns 不调用真实模型的人物蒸馏运行夹具。
 */
function createRun(overrides: Partial<PersonaDistillationRunView> = {}): PersonaDistillationRunView {
  return {
    id: RUN_ID,
    retryOfRunId: null,
    status: 'awaiting_source_review',
    requestedName: '顾岚',
    objective: '提炼谨慎且重视证据的判断方式。',
    worldId: null,
    provider: 'sqlite_fts5',
    coverageSnapshot: {
      sourceCount: 1,
      independentSourceCount: 1,
      directIndependentSourceCount: 1,
      duplicateSourceCount: 0,
      dimensionIndependentSourceCounts: {
        writings: 1,
        conversations: 0,
        expression: 1,
        external_views: 0,
        decisions: 0,
        timeline: 0,
      },
      warnings: ['缺少实际决策资料。'],
    },
    qualityGate: { hardFailures: [], softWarnings: ['当前判断主要来自公开表达。'] },
    candidateName: '顾岚',
    candidatePromptText: '# 心智模型\n先明确判断依据。',
    candidatePromptHash: CANDIDATE_HASH,
    evaluatedPromptHash: CANDIDATE_HASH,
    createdPersonaId: null,
    errorCode: null,
    errorMessage: null,
    inputs: [{
      id: '31000000-0000-4000-8000-000000000001',
      inputType: 'source_material',
      sourceId: '32000000-0000-4000-8000-000000000001',
      name: '人物访谈',
      sourceRole: 'canon_fact',
      sourceRelation: 'direct_conversation',
      coverageDimensions: ['writings', 'expression'],
      independentSourceKey: 'interview-1',
      contentHash: 'b'.repeat(64),
      contentSnapshot: '我会先明确判断依据。',
      sourceAvailable: true,
      accepted: true,
      originUrl: null,
      authorName: null,
      publishedAt: null,
    }],
    claims: [{
      id: '33000000-0000-4000-8000-000000000001',
      category: 'mental_model',
      statement: '先明确判断依据。',
      applicability: '事实判断',
      limitations: '资料不足时承认未知。',
      basis: 'explicit',
      confidence: 0.9,
      independentSourceCount: 1,
      crossContextCount: 1,
      status: 'valid',
      rejectionReasons: [],
      warnings: [],
      conflicts: [],
      evidence: [{
        id: '34000000-0000-4000-8000-000000000001',
        inputId: '31000000-0000-4000-8000-000000000001',
        relation: 'supporting',
        quote: '我会先明确判断依据。',
        quoteHash: 'c'.repeat(64),
      }],
    }],
    evaluations: [
      'known_fact',
      'decision_tendency',
      'unknown_boundary',
      'expression',
      'counterfactual',
      'conflict_handling',
    ].map((evaluationType, index) => ({
      id: `35000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      roundNo: 1,
      candidatePromptHash: CANDIDATE_HASH,
      evaluationType: evaluationType as PersonaDistillationRunView['evaluations'][number]['evaluationType'],
      status: 'passed',
      score: 1,
      failureReasons: [],
      output: { summary: `${evaluationType} 通过` },
    })),
    createdAt: 1_000,
    updatedAt: 2_000,
    completedAt: null,
    ...overrides,
  }
}

let pageRun = createRun()
let cancelRequests = 0

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint(`/api/v1/persona-distillations/${RUN_ID}`, () => ({ data: pageRun }))
registerEndpoint(`/api/v1/persona-distillations/${RUN_ID}/cancel`, {
  method: 'POST',
  handler: async () => {
    cancelRequests += 1
    await new Promise(resolve => setTimeout(resolve, 20))
    pageRun = createRun({ status: 'canceled', updatedAt: 3_000 })
    return { data: pageRun }
  },
})

describe('人物蒸馏后台工作区', () => {
  beforeEach(() => {
    pageRun = createRun()
    cancelRequests = 0
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('资料覆盖检查点提交接受范围和运行级分类纠正', async () => {
    const wrapper = await mountSuspended(CoverageReview, {
      props: { run: createRun(), loading: false },
    })

    expect(wrapper.text()).toContain('缺少实际决策资料。')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      expectedUpdatedAt: 2_000,
      acceptedInputIds: ['31000000-0000-4000-8000-000000000001'],
      corrections: [{
        inputId: '31000000-0000-4000-8000-000000000001',
        sourceRelation: 'direct_conversation',
        coverageDimensions: ['writings', 'expression'],
      }],
    })
  })

  it('最终检查点展示证据，正文修改后只允许保存重评，未修改候选才允许确认', async () => {
    const wrapper = await mountSuspended(CandidateReview, {
      props: { run: createRun({ status: 'awaiting_candidate_review' }), loading: false },
    })

    expect(wrapper.text()).toContain('我会先明确判断依据。')
    const confirmButton = wrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '确认创建人物')
    if (!confirmButton) throw new Error('最终检查点缺少确认创建人物按钮')
    expect(confirmButton.props('disabled')).toBe(false)
    await confirmButton.trigger('click')
    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      expectedUpdatedAt: 2_000,
      name: '顾岚',
      expectedPromptHash: CANDIDATE_HASH,
    })

    await wrapper.get('textarea').setValue('# 心智模型\n修改后的正文。')
    expect(confirmButton.props('disabled')).toBe(true)
    const saveButton = wrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '保存并重新评测')
    if (!saveButton) throw new Error('最终检查点缺少保存并重新评测按钮')
    await saveButton.trigger('click')
    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      expectedUpdatedAt: 2_000,
      promptText: '# 心智模型\n修改后的正文。',
    })
  })

  it('恢复人工检查点后重复点击取消只发送一次请求', async () => {
    const wrapper = await mountSuspended(PersonaDistillationPage, {
      route: `/personas/distillations/${RUN_ID}`,
    })
    const cancelButton = wrapper.findAllComponents({ name: 'UButton' }).find(button => button.text() === '取消运行')
    if (!cancelButton) throw new Error('人物蒸馏工作区缺少取消按钮')

    await Promise.all([cancelButton.trigger('click'), cancelButton.trigger('click')])
    await vi.waitFor(() => expect(cancelRequests).toBe(1))
    await vi.waitFor(() => expect(wrapper.text()).toContain('人物蒸馏已取消'))
  })

  it('失败运行展示脱敏错误和固定输入重试入口', async () => {
    pageRun = createRun({ status: 'failed', errorCode: 'MODEL_OUTPUT_INVALID', errorMessage: '人物蒸馏模型输出无效。' })
    const wrapper = await mountSuspended(PersonaDistillationPage, {
      route: `/personas/distillations/${RUN_ID}`,
    })

    await vi.waitFor(() => expect(wrapper.text()).toContain('人物蒸馏模型输出无效。'))
    expect(wrapper.findAllComponents({ name: 'UButton' }).some(button => button.text() === '使用固定输入重试')).toBe(true)
  })
})
