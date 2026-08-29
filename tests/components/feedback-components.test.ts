import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import EvaluationResultTable from '../../app/components/feedback/EvaluationResultTable.vue'
import FeedbackClassificationReview from '../../app/components/feedback/FeedbackClassificationReview.vue'
import FeedbackForm from '../../app/components/feedback/FeedbackForm.vue'
import RevisionProposalReview from '../../app/components/feedback/RevisionProposalReview.vue'
import type { PersonaSnapshot } from '../../shared/types/content'
import type { FeedbackView, RevisionProposalView } from '../../shared/types/feedback'

/** 组件测试使用的不可变人物快照。 */
const SNAPSHOT: PersonaSnapshot = {
  summary: '谨慎的档案管理员',
  identityFacts: '负责整理学院档案',
  interests: '历史与手稿',
  valuesAndMotivations: '准确优先',
  expressionStyle: '简洁克制',
  appearance: '深色长袍',
  visualStyle: '低饱和纸张质感',
  constraints: '不得虚构史实',
}

/** @param targetType AI 建议的反馈目标。 @returns 尚未确认的固定反馈。 */
function createFeedback(targetType: FeedbackView['suggestion']['targetType']): FeedbackView {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    runId: '00000000-0000-4000-8000-000000000002',
    blockId: null,
    content: '调整表达方式',
    rating: 'negative',
    isLongTerm: true,
    editedOutput: null,
    suggestion: { targetType, confidence: 0.8, rationale: '测试分类建议' },
    confirmedTarget: null,
    resolution: null,
    createdAt: 1_000,
    confirmedAt: null,
  }
}

/** 组件测试使用的待评测修订提案。 */
const PROPOSAL: RevisionProposalView = {
  id: '00000000-0000-4000-8000-000000000010',
  feedbackId: '00000000-0000-4000-8000-000000000011',
  personaId: '00000000-0000-4000-8000-000000000012',
  baseVersionId: '00000000-0000-4000-8000-000000000013',
  candidateVersionId: '00000000-0000-4000-8000-000000000014',
  riskLevel: 'high',
  status: 'awaiting_evaluation',
  patches: [{ field: 'expressionStyle', before: '简洁克制', after: '简洁克制并使用短句', reason: '用户反馈' }],
  riskReasons: ['测试风险'],
  hasEvidenceConflict: false,
  latestEvaluationRunId: null,
  decisionReason: null,
  createdAt: 1_000,
  updatedAt: 1_000,
}

describe('阶段五反馈组件', () => {
  it('阻止提交空反馈', async () => {
    const wrapper = await mountSuspended(FeedbackForm)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('反馈内容不能为空')
  })

  it('长期人物确认提交字段级完整补丁', async () => {
    const wrapper = await mountSuspended(FeedbackClassificationReview, {
      props: { feedback: createFeedback('persona'), personaSnapshot: SNAPSHOT },
    })
    const textareas = wrapper.findAll('textarea')
    await textareas[0]!.setValue('简洁克制并使用短句')
    await textareas[1]!.setValue('用户明确要求长期调整')
    await wrapper.findAll('button').find(button => button.text().includes('确认分类'))!.trigger('click')

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toMatchObject({
      targetType: 'persona',
      personaPatches: [{ field: 'expressionStyle', after: '简洁克制并使用短句', reason: '用户明确要求长期调整' }],
    })
  })

  it('当前产物分类必须选择具体块', async () => {
    const wrapper = await mountSuspended(FeedbackClassificationReview, {
      props: { feedback: createFeedback('artifact'), personaSnapshot: SNAPSHOT },
    })
    await wrapper.findAll('button').find(button => button.text().includes('确认分类'))!.trigger('click')

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.text()).toContain('当前产物反馈必须选择具体产物块')
  })

  it('资料事实分类必须选择具体资料', async () => {
    const wrapper = await mountSuspended(FeedbackClassificationReview, {
      props: { feedback: createFeedback('source_fact'), personaSnapshot: SNAPSHOT },
    })
    await wrapper.findAll('button').find(button => button.text().includes('确认分类'))!.trigger('click')

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.text()).toContain('资料事实反馈必须选择资料')
  })

  it('拒绝修订提案必须填写原因', async () => {
    const wrapper = await mountSuspended(RevisionProposalReview, { props: { proposal: PROPOSAL } })
    await wrapper.findAll('button').find(button => button.text().includes('拒绝提案'))!.trigger('click')

    expect(wrapper.emitted('reject')).toBeUndefined()
    expect(wrapper.text()).toContain('拒绝提案必须填写原因')
  })

  it('评测输出按文本渲染而不执行不可信内容', async () => {
    const wrapper = await mountSuspended(EvaluationResultTable, {
      props: {
        results: [{
          id: '00000000-0000-4000-8000-000000000020',
          caseId: '00000000-0000-4000-8000-000000000021',
          caseName: '安全输出',
          status: 'passed',
          baseScore: 0.7,
          candidateScore: 0.8,
          baseOutput: '<script>alert(1)</script>',
          candidateOutput: '<img src=x onerror=alert(1)>',
          failures: [],
          reasoningSummary: '<b>仅作为文本</b>',
        }],
      },
    })

    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('<script>alert(1)</script>')
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
  })
})
