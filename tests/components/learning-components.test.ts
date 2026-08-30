import { describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PersonaFeedbackSourcePanel from '../../app/components/learning/PersonaFeedbackSourcePanel.vue'
import GrowthRecordPanel from '../../app/components/learning/GrowthRecordPanel.vue'

describe('成长与记忆管理组件', () => {
  it('人物反馈资料必须填写标题和正文后才提交', async () => {
    const wrapper = await mountSuspended(PersonaFeedbackSourcePanel, { props: { items: [], loading: false } })
    await wrapper.get('[data-feedback-source-add-button]').trigger('click')
    await flushPromises()
    const form = document.querySelector<HTMLElement>('[data-feedback-source-form]')
    const titleInput = form?.querySelector<HTMLInputElement>('input')
    const contentInput = form?.querySelector<HTMLTextAreaElement>('textarea')
    expect(form).toBeDefined()
    expect(titleInput).toBeDefined()
    expect(contentInput).toBeDefined()
    await new DOMWrapper(titleInput!).setValue('表达反馈')
    await new DOMWrapper(contentInput!).setValue('先给结论。')
    await new DOMWrapper(form!).trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('create')).toEqual([[{ title: '表达反馈', content: '先给结论。', sourceType: 'manual' }]])
  })

  it('没有成长原始资料时仍可打开导入说明且不提供手工添加', async () => {
    const wrapper = await mountSuspended(GrowthRecordPanel, {
      props: {
        items: [], loading: false, subjectLabel: '人物',
        sources: [],
      },
    })

    expect(wrapper.find('[data-growth-add-button]').exists()).toBe(false)
    expect(wrapper.get('[data-growth-import-button]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-growth-import-button]').trigger('click')
    await flushPromises()

    const form = document.querySelector<HTMLElement>('[data-growth-import-form]')
    expect(form).toBeDefined()
    expect(form?.textContent).toContain('请先在人物反馈资料中添加内容')
    expect(form?.textContent).not.toContain('适用范围')
    wrapper.unmount()
  })

  it('成长记录支持资料逐条评分后批量导入', async () => {
    const firstSourceId = '40000000-0000-4000-8000-000000000001'
    const secondSourceId = '40000000-0000-4000-8000-000000000002'
    const wrapper = await mountSuspended(GrowthRecordPanel, {
      props: {
        items: [], loading: false, subjectLabel: '人物',
        sources: [
          { id: firstSourceId, label: '反馈一', content: '先给结论。', isEnabled: true },
          { id: secondSourceId, label: '反馈二', content: '减少夸张修辞。', isEnabled: false },
        ],
      },
    })

    await wrapper.get('[data-growth-import-button]').trigger('click')
    await flushPromises()
    const form = document.querySelector<HTMLElement>('[data-growth-import-form]')
    expect(form).toBeDefined()
    const sourceRows = [...form!.querySelectorAll<HTMLElement>('[data-growth-import-source]')]
    expect(sourceRows).toHaveLength(2)
    await new DOMWrapper(sourceRows[0]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!).trigger('click')
    await new DOMWrapper(sourceRows[1]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!).trigger('click')
    await flushPromises()
    await new DOMWrapper(sourceRows[0]!.querySelector<HTMLInputElement>('input[type="number"]')!).setValue(5)
    await new DOMWrapper(sourceRows[1]!.querySelector<HTMLInputElement>('input[type="number"]')!).setValue(2)
    const submitButton = [...form!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('导入 2 项资料'))
    expect(submitButton).toBeDefined()
    await new DOMWrapper(submitButton!).trigger('click')
    await flushPromises()

    expect(wrapper.emitted('importSources')).toEqual([[{
      items: [
        { sourceId: firstSourceId, importance: 5 },
        { sourceId: secondSourceId, importance: 2 },
      ],
    }]])
    expect(form!.textContent).not.toContain('适用范围')
  })

  it('成长内容分页展示并提供修改和批量管理入口', async () => {
    const items = Array.from({ length: 11 }, (_, index) => ({
      id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      subjectType: 'persona' as const,
      subjectId: '40000000-0000-4000-8000-000000000100',
      status: 'active' as const,
      revisionId: `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      revisionNo: 1,
      content: `成长内容 ${index + 1}`,
      scope: '所有新任务',
      importance: 3,
      conflictSummary: null,
      evidenceCount: 1,
      createdAt: index,
      updatedAt: index,
    }))
    const wrapper = await mountSuspended(GrowthRecordPanel, {
      props: { items, sources: [], loading: false, subjectLabel: '人物' },
    })

    expect(wrapper.text()).toContain('成长内容 1')
    expect(wrapper.text()).not.toContain('成长内容 11')
    expect(wrapper.findAll('[data-growth-edit-button]')).toHaveLength(10)
    expect(wrapper.find('[data-growth-delete-button]').exists()).toBe(false)

    await wrapper.get('[data-growth-edit-button]').trigger('click')
    await flushPromises()
    const editorForm = document.querySelector<HTMLElement>('[data-growth-editor-form]')
    const editorTextarea = editorForm?.querySelector<HTMLTextAreaElement>('textarea')
    expect(editorTextarea?.value).toBe('成长内容 1')
    expect(editorForm?.textContent).not.toContain('适用范围')
    await new DOMWrapper(editorTextarea!).setValue('修改后的成长内容')
    await new DOMWrapper(editorForm!).trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('update')).toEqual([[expect.objectContaining({
      id: items[0]!.id, content: '修改后的成长内容', importance: 3,
    })]])
    expect(wrapper.text()).not.toContain('适用范围')

    await wrapper.get('[data-growth-row-checkbox]').setValue(true)
    expect(wrapper.find('[data-growth-delete-button]').exists()).toBe(true)
    expect(wrapper.text()).toContain('批量启用')
    expect(wrapper.text()).toContain('批量禁用')
    await wrapper.get('[data-growth-delete-button]').trigger('click')
    await flushPromises()
    const confirmDeleteButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('确认永久删除'))
    expect(confirmDeleteButton).toBeDefined()
    await new DOMWrapper(confirmDeleteButton!).trigger('click')
    await flushPromises()
    expect(wrapper.emitted('delete')).toEqual([[{ ids: [items[0]!.id] }]])
  })
})
