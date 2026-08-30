import { describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import GrowthMaterialPanel from '../../app/components/learning/GrowthMaterialPanel.vue'
import LearningPromptPanel from '../../app/components/learning/LearningPromptPanel.vue'
import OperationRecordPanel from '../../app/components/learning/OperationRecordPanel.vue'

describe('成长与记忆管理组件', () => {
  it('成长素材支持从资料库逐条评分批量导入', async () => {
    const firstSourceId = '40000000-0000-4000-8000-000000000001'
    const secondSourceId = '40000000-0000-4000-8000-000000000002'
    const wrapper = await mountSuspended(GrowthMaterialPanel, {
      props: {
        items: [], loading: false, subjectLabel: '人物',
        sources: [
          { id: firstSourceId, name: '资料一', summary: '先给结论。', content: '先给结论。', contentHash: '1'.repeat(64), isEnabled: true, isImported: false },
          { id: secondSourceId, name: '资料二', summary: '减少夸张。', content: '减少夸张修辞。', contentHash: '2'.repeat(64), isEnabled: false, isImported: true },
        ],
      },
    })

    await wrapper.get('[data-growth-import-button]').trigger('click')
    await flushPromises()
    const form = document.querySelector<HTMLElement>('[data-growth-import-form]')
    const rows = [...form!.querySelectorAll<HTMLElement>('[data-growth-import-source]')]
    expect(rows).toHaveLength(2)
    expect(form!.textContent).toContain('已在素材池')
    await new DOMWrapper(rows[0]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!).trigger('click')
    await new DOMWrapper(rows[1]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!).trigger('click')
    await new DOMWrapper(rows[0]!.querySelector<HTMLInputElement>('input[type="number"]')!).setValue(5)
    await new DOMWrapper(rows[1]!.querySelector<HTMLInputElement>('input[type="number"]')!).setValue(2)
    const submitButton = [...form!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('导入 2 项资料'))
    await new DOMWrapper(submitButton!).trigger('click')
    await flushPromises()

    expect(wrapper.emitted('importSources')).toEqual([[{
      items: [
        { sourceId: firstSourceId, importance: 5 },
        { sourceId: secondSourceId, importance: 2 },
      ],
    }]])
    wrapper.unmount()
  })

  it('手工文档通过弹窗添加，明确只进入素材池', async () => {
    const wrapper = await mountSuspended(GrowthMaterialPanel, {
      props: { items: [], sources: [], loading: false, subjectLabel: '人物' },
    })
    await wrapper.get('[data-growth-add-button]').trigger('click')
    await flushPromises()
    const form = document.querySelector<HTMLElement>('[data-growth-editor-form]')
    const titleInput = form!.querySelector<HTMLInputElement>('input[type="text"]')
    const textarea = form!.querySelector<HTMLTextAreaElement>('textarea')
    const scoreInput = form!.querySelector<HTMLInputElement>('input[type="number"]')
    expect(document.body.textContent).toContain('不会加入普通资料库')
    await new DOMWrapper(titleInput!).setValue('表达经验')
    await new DOMWrapper(textarea!).setValue('先给结论，再说明证据。')
    await new DOMWrapper(scoreInput!).setValue(5)
    await new DOMWrapper(form!).trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('create')).toEqual([[{
      title: '表达经验', content: '先给结论，再说明证据。', importance: 5,
    }]])
    wrapper.unmount()
  })

  it('成长素材分页展示，支持来源变化提醒、修改与跨页批量管理', async () => {
    const items = Array.from({ length: 11 }, (_, index) => ({
      id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      subjectType: 'persona' as const,
      subjectId: '40000000-0000-4000-8000-000000000100',
      title: `成长素材 ${index + 1}`,
      content: `成长素材正文 ${index + 1}`,
      contentHash: String(index + 1).padStart(64, '0'),
      sourceType: index === 0 ? 'source_material' as const : 'manual' as const,
      sourceId: index === 0 ? '40000000-0000-4000-8000-000000000200' : null,
      sourceState: index === 0 ? 'changed' as const : 'not_applicable' as const,
      importance: 3,
      isEnabled: true,
      createdAt: index,
      updatedAt: index,
    }))
    const wrapper = await mountSuspended(GrowthMaterialPanel, {
      props: { items, sources: [], loading: false, subjectLabel: '人物' },
    })

    expect(wrapper.text()).toContain('成长素材 1')
    expect(wrapper.text()).not.toContain('成长素材 11')
    expect(wrapper.text()).toContain('资料库原文已变化')
    expect(wrapper.findAll('[data-growth-edit-button]')).toHaveLength(10)
    await wrapper.get('[data-growth-edit-button]').trigger('click')
    await flushPromises()
    const editorForm = document.querySelector<HTMLElement>('[data-growth-editor-form]')
    const textInputs = [...editorForm!.querySelectorAll<HTMLInputElement>('input[type="text"]')]
    const textarea = editorForm!.querySelector<HTMLTextAreaElement>('textarea')
    expect(textInputs[0]?.value).toBe('成长素材 1')
    await new DOMWrapper(textInputs[0]!).setValue('修改后的素材')
    await new DOMWrapper(textarea!).setValue('修改后的完整正文')
    await new DOMWrapper(editorForm!).trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('update')).toEqual([[expect.objectContaining({
      id: items[0]!.id, title: '修改后的素材', content: '修改后的完整正文', importance: 3,
    })]])

    await wrapper.get('[data-growth-row-checkbox]').setValue(true)
    expect(wrapper.text()).toContain('批量启用')
    expect(wrapper.text()).toContain('批量禁用')
    await wrapper.get('[data-growth-delete-button]').trigger('click')
    await flushPromises()
    const deleteButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('确认永久删除'))
    await new DOMWrapper(deleteButton!).trigger('click')
    await flushPromises()
    expect(wrapper.emitted('delete')).toEqual([[{ ids: [items[0]!.id] }]])
    wrapper.unmount()
  })

  it('完整提示词必须先保存草稿，再发布或基于历史版本校准', async () => {
    const activeVersion = {
      id: '50000000-0000-4000-8000-000000000001', versionNo: 1, parentVersionId: null,
      promptText: '当前生效提示词。', sourceAnalysisBatchId: null, changeSummary: '建立提示词',
      createdBy: 'user' as const, publishedAt: 1,
    }
    const draft = {
      id: '50000000-0000-4000-8000-000000000002', baseVersionId: activeVersion.id,
      promptText: '待校准提示词。', sourceAnalysisBatchId: null, createdBy: 'user' as const,
      createdAt: 2, updatedAt: 2,
    }
    const wrapper = await mountSuspended(LearningPromptPanel, {
      props: {
        title: '人物成长', loading: false,
        workspace: { promptType: 'persona_growth', activeVersion, draft, versions: [activeVersion] },
      },
    })
    expect(wrapper.text()).toContain('只有已发布版本会固定进入')
    expect(wrapper.get('[data-learning-prompt-editor]').element.value).toBe('待校准提示词。')
    await wrapper.get('[data-learning-prompt-editor]').setValue('人工校准后的完整提示词。')
    const buttons = wrapper.findAll('button')
    await buttons.find(button => button.text().includes('保存草稿'))!.trigger('click')
    await buttons.find(button => button.text().includes('发布并用于新任务'))!.trigger('click')
    expect(wrapper.emitted('save')).toEqual([[{
      promptText: '人工校准后的完整提示词。', baseVersionId: activeVersion.id,
    }]])
    expect(wrapper.emitted('publish')).toEqual([[{ changeSummary: '发布校准后的提示词' }]])

    await buttons.find(button => button.text().includes('基于此版本校准'))!.trigger('click')
    await flushPromises()
    const rollbackButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('创建校准草稿'))
    await new DOMWrapper(rollbackButton!).trigger('click')
    expect(wrapper.emitted('draftFromVersion')).toEqual([[{ versionId: activeVersion.id }]])
    wrapper.unmount()
  })

  it('历史任务素材支持分页、批量启停和逐条评分', async () => {
    const items = Array.from({ length: 11 }, (_, index) => ({
      id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      personaId: '60000000-0000-4000-8000-000000000100',
      runId: `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      operationType: 'interest_assessment' as const,
      title: `任务 ${index + 1}`,
      content: `任务输入与结果 ${index + 1}`,
      contentHash: String(index + 1).padStart(64, '0'),
      resultSummary: `结果 ${index + 1}`,
      isEnabled: true,
      importance: 3,
      sessionRecordId: null,
      createdAt: index,
      updatedAt: index,
    }))
    const wrapper = await mountSuspended(OperationRecordPanel, { props: { items, loading: false } })
    expect(wrapper.text()).toContain('任务 1')
    expect(wrapper.text()).not.toContain('任务 11')
    const firstRow = wrapper.find('.learning-row')
    await firstRow.get('input[type="number"]').setValue(5)
    expect(wrapper.emitted('importance')).toEqual([[{ id: items[0]!.id, importance: 5 }]])
    await firstRow.get('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text().includes('批量禁用'))!.trigger('click')
    expect(wrapper.emitted('status')).toEqual([[{ ids: [items[0]!.id], isEnabled: false }]])
  })
})
