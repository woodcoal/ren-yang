import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import LearningAutomationControl from '../../app/components/learning/LearningAutomationControl.vue'
import LearningAutomationSettingsForm from '../../app/components/system/LearningAutomationSettingsForm.vue'

describe('学习自动化后台控件', () => {
  it('对象开关明确说明开启后会自动发布并发出布尔状态', async () => {
    const wrapper = await mountSuspended(LearningAutomationControl, {
      props: { enabled: false, subjectType: 'persona', loading: false },
    })

    expect(wrapper.text()).toContain('自动提炼并发布成长与记忆')
    await wrapper.get('[role="switch"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('change')).toEqual([[true]])
  })

  it('统一周期表单按小时提交整数值', async () => {
    const wrapper = await mountSuspended(LearningAutomationSettingsForm, {
      props: {
        settings: { intervalHours: 24, nextRunAt: 1_000, lastRunAt: null, updatedAt: 0 },
        loading: false,
      },
    })

    await wrapper.get('input[role="spinbutton"]').trigger('keydown', { key: 'ArrowUp' })
    await wrapper.get('form[data-learning-automation-settings]').trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('submit')).toEqual([[{ intervalHours: 25 }]])
  })
})
