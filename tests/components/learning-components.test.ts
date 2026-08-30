import { describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import GrowthMaterialPanel from '../../app/components/learning/GrowthMaterialPanel.vue'
import LearningPromptPanel from '../../app/components/learning/LearningPromptPanel.vue'
import OperationRecordPanel from '../../app/components/learning/OperationRecordPanel.vue'
import ExternalRecordPanel from '../../app/components/learning/ExternalRecordPanel.vue'
import type { AnalysisBatchView } from '../../shared/types/analysis'

/** 已完成一次人物成长提示词生成的测试批次。 */
const completedAnalysisBatch: AnalysisBatchView = {
  id: '51000000-0000-4000-8000-000000000001',
  analysisType: 'persona_growth',
  subjectId: '51000000-0000-4000-8000-000000000002',
  mode: 'full_rebuild',
  status: 'completed',
  baselineSoulVersionId: '51000000-0000-4000-8000-000000000003',
  inputs: [],
  proposals: [],
  resultSummary: '已重新整理人物成长提示词。',
  errorCode: null,
  errorMessage: null,
  createdAt: 1,
  updatedAt: 1,
  completedAt: 1,
}

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

  it('完整提示词以单一编辑框完成 AI 重生成、历史载入和保存发布', async () => {
    const activeVersion = {
      id: '50000000-0000-4000-8000-000000000001', versionNo: 1, parentVersionId: null,
      promptText: '当前生效提示词。', sourceAnalysisBatchId: null, changeSummary: '建立提示词',
      createdBy: 'user' as const, publishedAt: 1,
    }
    const draft = {
      id: '50000000-0000-4000-8000-000000000002', baseVersionId: activeVersion.id,
      promptText: '待校准提示词。', sourceAnalysisBatchId: completedAnalysisBatch.id, createdBy: 'analysis' as const,
      createdAt: 2, updatedAt: 2,
    }
    const wrapper = await mountSuspended(LearningPromptPanel, {
      props: {
        title: '人物成长', loading: false, batch: completedAnalysisBatch,
        workspace: { promptType: 'persona_growth', activeVersion, draft, versions: [activeVersion] },
      },
    })
    expect(wrapper.findAll('textarea')).toHaveLength(1)
    expect(wrapper.get('[data-learning-prompt-editor]').element.value).toBe('待校准提示词。')
    expect(wrapper.get('[data-learning-analyze-button]').text()).toBe('')
    expect(wrapper.get('[data-learning-history-button]').text()).toBe('')
    expect(wrapper.get('[data-learning-analyze-button]').attributes('aria-label')).toBe('重新 AI 生成提示词')
    expect(wrapper.get('[data-learning-history-button]').attributes('aria-label')).toBe('查看提示词历史')
    await wrapper.get('[data-learning-analyze-button]').trigger('click')
    expect(wrapper.emitted('analyze')).toEqual([['full_rebuild']])
    await wrapper.get('[data-learning-prompt-editor]').setValue('人工校准后的完整提示词。')
    await wrapper.get('[data-learning-save-publish-button]').trigger('click')
    expect(wrapper.emitted('saveAndPublish')).toEqual([[{
      promptText: '人工校准后的完整提示词。', baseVersionId: activeVersion.id,
    }]])

    await wrapper.get('[data-learning-history-button]').trigger('click')
    await flushPromises()
    const historyVersion = document.querySelector<HTMLButtonElement>('[data-learning-history-version]')
    expect(historyVersion).toBeDefined()
    await new DOMWrapper(historyVersion!).trigger('click')
    expect(wrapper.get('[data-learning-prompt-editor]').element.value).toBe('当前生效提示词。')
    wrapper.unmount()
  })

  it('AI 提示词正在生成时禁止重复生成并允许刷新状态', async () => {
    const wrapper = await mountSuspended(LearningPromptPanel, {
      props: {
        title: '人物记忆',
        loading: false,
        batch: { ...completedAnalysisBatch, status: 'queued', analysisType: 'persona_memory' },
        workspace: { promptType: 'persona_memory', activeVersion: null, draft: null, versions: [] },
      },
    })

    expect(wrapper.get('[data-learning-analyze-button]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-learning-refresh-button]').trigger('click')
    expect(wrapper.emitted('refresh')).toEqual([[]])
    expect(wrapper.text()).toContain('当前生成完成前不能重复提交')
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
    expect(wrapper.get(`a[href="/runs/${items[0]!.runId}"]`).text()).toBe('任务 1')
    const firstRow = wrapper.find('.learning-row')
    await firstRow.get('input[type="number"]').setValue(5)
    expect(wrapper.emitted('importance')).toEqual([[{ id: items[0]!.id, importance: 5 }]])
    await firstRow.get('input[type="checkbox"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text().includes('批量禁用'))!.trigger('click')
    expect(wrapper.emitted('status')).toEqual([[{ ids: [items[0]!.id], isEnabled: false }]])
  })

  it('第三方记录通过弹窗添加并保留多项参考地址', async () => {
    const wrapper = await mountSuspended(ExternalRecordPanel, { props: { items: [], loading: false } })
    await wrapper.get('[data-external-record-add]').trigger('click')
    await flushPromises()
    const form = document.querySelector<HTMLElement>('[data-external-record-form]')
    expect(form).toBeDefined()
    await new DOMWrapper(form!.querySelector<HTMLInputElement>('input[type="date"]')!).setValue('2026-08-31')
    await new DOMWrapper(form!.querySelector<HTMLTextAreaElement>('textarea')!).setValue('完成小说人物关系校对。')
    const addReferenceButton = [...form!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('添加参考'))
    await new DOMWrapper(addReferenceButton!).trigger('click')
    await flushPromises()
    const textInputs = [...form!.querySelectorAll<HTMLInputElement>('input[type="text"]')]
    await new DOMWrapper(textInputs[0]!).setValue('校对笔记')
    await new DOMWrapper(textInputs[1]!).setValue('笔记库/小说/第三章')
    await new DOMWrapper(form!).trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('create')).toEqual([[{
      occurredOn: '2026-08-31', content: '完成小说人物关系校对。',
      references: [{ name: '校对笔记', address: '笔记库/小说/第三章' }], importance: 3,
    }]])
    wrapper.unmount()
  })
})
