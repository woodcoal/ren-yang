import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import FeedbackClassificationReview from '../../app/components/feedback/FeedbackClassificationReview.vue'
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
    resolution: null,
    createdAt: 1_000,
    confirmedAt: null,
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

  it('当前产物分类必须选择具体块', async () => {
    const wrapper = await mountSuspended(FeedbackClassificationReview, {
      props: { feedback: createFeedback('artifact') },
    })
    await wrapper.findAll('button').find(button => button.text().includes('确认用途'))!.trigger('click')

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.text()).toContain('当前产物反馈必须选择具体产物块')
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
