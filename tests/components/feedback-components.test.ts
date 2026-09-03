import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import FeedbackClassificationReview from '../../app/components/feedback/FeedbackClassificationReview.vue'
import FeedbackImpactPanel from '../../app/components/feedback/FeedbackImpactPanel.vue'
import FeedbackForm from '../../app/components/feedback/FeedbackForm.vue'
import type { FeedbackView } from '../../shared/types/feedback'

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
    impact: null,
    resolution: null,
    createdAt: 1_000,
    confirmedAt: null,
  }
}

/** @returns 已进入成长分析与发布链路的人物反馈影响。 */
function createPersonaImpact(): NonNullable<FeedbackView['impact']> {
  return {
    targetType: 'persona',
    personaId: '00000000-0000-4000-8000-000000000003',
    feedbackSourceId: '00000000-0000-4000-8000-000000000004',
    growthMaterialId: '00000000-0000-4000-8000-000000000004',
    material: { importance: 3, isEnabled: true },
    analysis: {
      id: '00000000-0000-4000-8000-000000000005', status: 'completed',
      resultSummary: '已生成成长草稿。', errorMessage: null, completedAt: 1_000,
    },
    publishedPrompt: { id: '00000000-0000-4000-8000-000000000006', versionNo: 2, publishedAt: 2_000 },
    affectedRuns: [{ id: '00000000-0000-4000-8000-000000000007', personaName: '林默', status: 'succeeded', createdAt: 3_000 }],
  }
}

describe('反馈组件', () => {
  it('阻止提交空反馈', async () => {
    const wrapper = await mountSuspended(FeedbackForm)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('反馈内容不能为空')
  })

  it('就近解释反馈用途并提供全宽文本编辑区', async () => {
    const wrapper = await mountSuspended(FeedbackForm)
    const textareas = wrapper.findAll('textarea')

    expect(wrapper.text()).toContain('提交后由 AI 建议用途，最终仍由你确认')
    expect(wrapper.text()).toContain('正向表示认可并希望保留')
    expect(wrapper.text()).toContain('当前只作为人工标签保存')
    expect(wrapper.text()).toContain('不会自动替换当前结果，也不会直接成为成长素材')
    expect(textareas).toHaveLength(2)
    expect(textareas.every(textarea => textarea.classes().includes('w-full'))).toBe(true)
  })

  it('人物反馈确认只创建成长素材意图，不提交灵魂字段补丁', async () => {
    const wrapper = await mountSuspended(FeedbackClassificationReview, {
      props: { feedback: createFeedback('persona') },
    })
    await wrapper.findAll('button').find(button => button.text().includes('确认用途'))!.trigger('click')

    expect(wrapper.emitted('confirm')?.[0]?.[0]).toEqual({
      targetType: 'persona',
      blockId: null,
      sourceId: null,
      hasEvidenceConflict: false,
    })
    expect(wrapper.text()).toContain('人工校准发布后才会进入新任务')
  })

  it('展示人物反馈从成长素材到后续实际运行的完整影响链路', async () => {
    const wrapper = await mountSuspended(FeedbackImpactPanel, { props: { impact: createPersonaImpact() } })

    expect(wrapper.text()).toContain('已加入人物成长链路')
    expect(wrapper.text()).toContain('评分 3，参加提炼')
    expect(wrapper.text()).toContain('已生成草稿')
    expect(wrapper.text()).toContain('已发布成长提示词版本 2')
    expect(wrapper.get('a').attributes('href')).toBe('/runs/00000000-0000-4000-8000-000000000007')
  })

  it('当前结果分类必须选择需要修正的具体内容', async () => {
    const wrapper = await mountSuspended(FeedbackClassificationReview, {
      props: { feedback: createFeedback('artifact') },
    })
    await wrapper.findAll('button').find(button => button.text().includes('确认用途'))!.trigger('click')

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.text()).toContain('当前结果反馈必须选择需要修正的具体内容')
  })

  it('资料事实分类必须选择具体资料', async () => {
    const wrapper = await mountSuspended(FeedbackClassificationReview, {
      props: { feedback: createFeedback('source_fact') },
    })
    await wrapper.findAll('button').find(button => button.text().includes('确认用途'))!.trigger('click')

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.text()).toContain('资料事实反馈必须选择资料')
  })
})
