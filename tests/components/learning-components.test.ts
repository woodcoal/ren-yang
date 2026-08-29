import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PersonaFeedbackSourcePanel from '../../app/components/learning/PersonaFeedbackSourcePanel.vue'
import GrowthRecordPanel from '../../app/components/learning/GrowthRecordPanel.vue'

describe('成长与记忆管理组件', () => {
  it('人物反馈资料必须填写标题和正文后才提交', async () => {
    const wrapper = await mountSuspended(PersonaFeedbackSourcePanel, { props: { items: [], loading: false } })
    await wrapper.get('input').setValue('表达反馈')
    await wrapper.get('textarea').setValue('先给结论。')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('create')).toEqual([[{ title: '表达反馈', content: '先给结论。', sourceType: 'manual' }]])
  })

  it('成长记录创建的是候选并携带显式来源', async () => {
    const sourceId = '40000000-0000-4000-8000-000000000001'
    const wrapper = await mountSuspended(GrowthRecordPanel, {
      props: { items: [], sources: [{ id: sourceId, label: '反馈一' }], loading: false, subjectLabel: '人物' },
    })
    await wrapper.get('textarea').setValue('先给结论。')
    await wrapper.get('select').setValue(sourceId)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('create')).toEqual([[{
      content: '先给结论。', scope: '所有新任务', importance: 3, sourceIds: [sourceId],
    }]])
    expect(wrapper.text()).toContain('只有确认后才会进入新任务')
  })
})
