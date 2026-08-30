import { describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises, type VueWrapper } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PersonaDraftAssistant from '../../app/components/content/PersonaDraftAssistant.vue'
import PersonaForm from '../../app/components/content/PersonaForm.vue'
import QuickCreateSubjectModal from '../../app/components/content/QuickCreateSubjectModal.vue'
import SourceImportForm from '../../app/components/content/SourceImportForm.vue'
import SubjectSourceManager from '../../app/components/content/SubjectSourceManager.vue'
import WorldForm from '../../app/components/content/WorldForm.vue'
import SoulWorkspace from '../../app/components/content/SoulWorkspace.vue'

/**
 * 按用户可见文本在资料对象标签选择器中搜索并选择一项。
 * @param wrapper 当前挂载的资料表单包装器。
 * @param searchTerm 输入到搜索框的部分名称。
 * @param optionLabel 期望选择的完整可见标签。
 * @returns 选项点击及响应式更新完成时结束。
 */
async function selectSourceTarget(wrapper: VueWrapper, searchTerm: string, optionLabel: string): Promise<void> {
  const input = wrapper.get('input[aria-label="资料使用对象"]')
  await input.trigger('focus')
  await input.setValue(searchTerm)
  await flushPromises()
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    .find(element => element.textContent?.includes(optionLabel))
  expect(option).toBeDefined()
  await new DOMWrapper(option!).trigger('click')
  await flushPromises()
}

describe('阶段二内容表单', () => {
  it('快速创建弹窗只提交自然语言且失败时保留原文', async () => {
    const wrapper = await mountSuspended(QuickCreateSubjectModal, {
      props: { open: true, subjectType: 'world', loading: false, errorMessage: '模型暂时不可用' },
    })
    await flushPromises()

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea')
    expect(textarea).toBeDefined()
    await new DOMWrapper(textarea!).setValue('创建一个浮岛与风帆船构成的世界')
    const submitButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('生成并创建世界'))
    expect(submitButton).toBeDefined()
    await new DOMWrapper(submitButton!).trigger('click')
    await flushPromises()

    expect(wrapper.emitted('submit')).toEqual([['创建一个浮岛与风帆船构成的世界']])
    expect(textarea!.value).toBe('创建一个浮岛与风帆船构成的世界')
    expect(document.body.textContent).toContain('模型暂时不可用')
    expect(document.body.textContent).toContain('创建后仍是待确认草稿')

    await wrapper.setProps({ loading: true, errorMessage: null })
    await flushPromises()
    expect(document.body.textContent).toContain('AI 正在生成世界初始设定')
    expect(document.body.textContent).toContain('请保持当前页面开启，不要重复提交')
    expect(document.querySelector('[data-subject-creation-overlay]')?.className).toContain('fixed')
    expect(document.querySelector('[data-subject-creation-overlay]')?.className).toContain('z-[9999]')
    expect(document.querySelector('[data-subject-creation-overlay]')?.className).toContain('bg-default/55')
    expect(document.querySelector('[data-subject-creation-overlay]')?.className).toContain('backdrop-blur-md')
    expect(document.querySelector('[data-subject-creation-spinner]')?.className).toContain('animate-spin')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('原创人物在没有世界和资料时仍可提交初始候选档案', async () => {
    const wrapper = await mountSuspended(PersonaForm, {
      props: { worlds: [], sources: [], loading: false, errorMessage: null },
    })
    const inputs = wrapper.findAll('input')
    const textareas = wrapper.findAll('textarea')
    await inputs[0]!.setValue('林默')
    await textareas[0]!.setValue('谨慎的档案管理员，资料不足时说明未知。')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('submit')).toEqual([[
      expect.objectContaining({
        name: '林默',
        origin: 'original',
        worldId: null,
        sourceIds: [],
        snapshot: { promptText: '谨慎的档案管理员，资料不足时说明未知。' },
      }),
    ]])
  })

  it('AI 草稿助手提交自然语言与选中的参考资料，但不直接创建人物', async () => {
    const sourceId = '00000000-0000-4000-8000-000000000001'
    const wrapper = await mountSuspended(PersonaDraftAssistant, {
      props: {
        worlds: [],
        sources: [{
          id: sourceId, name: '学院资料', role: 'canon_fact', inputType: 'paste', contentHash: 'a'.repeat(64),
          contentText: '学院事实', originalFilePath: null, isEnabled: true, chunkCount: 1, linkCount: 0, createdAt: 1_000, updatedAt: 1_000,
        }],
        textModelConfigured: true,
        loading: false,
        errorMessage: null,
      },
    })
    await wrapper.get('textarea').setValue('创建一名谨慎的档案员')
    await wrapper.get('select[multiple]').setValue(sourceId)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('generate')).toEqual([[
      expect.objectContaining({ prompt: '创建一名谨慎的档案员', origin: 'original', sourceIds: [sourceId] }),
    ]])
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('结构化表单收到 AI 草稿后完整替换字段并仍需用户提交', async () => {
    const initialValue = {
      name: '林默',
      origin: 'original' as const,
      worldId: null,
      sourceIds: [],
      snapshot: { promptText: '谨慎的档案管理员，冷静简洁，未知事实必须说明不知道。' },
      changeSummary: '根据自然语言生成初始候选档案',
    }
    const wrapper = await mountSuspended(PersonaForm, {
      props: { worlds: [], sources: [], loading: false, errorMessage: null, initialValue },
    })
    await flushPromises()

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect((wrapper.findAll('input')[0]!.element as HTMLInputElement).value).toBe('林默')
    expect((wrapper.findAll('textarea')[0]!.element as HTMLTextAreaElement).value).toBe(initialValue.snapshot.promptText)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual(initialValue)
  })

  it('世界表单阻止空正文提交', async () => {
    const wrapper = await mountSuspended(WorldForm, {
      props: { loading: false, errorMessage: null },
    })
    await wrapper.findAll('input')[0]!.setValue('浮岛纪元')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('灵魂提示词不能为空')
    expect(wrapper.text()).toContain('简短说明')
    expect(wrapper.text()).toContain('直接进入人物任务')
  })

  it('灵魂使用单文本弹窗，可选择原文保存或自动分析且不会直接发布', async () => {
    const snapshot = { promptText: '当前灵魂提示词' }
    const wrapper = await mountSuspended(SoulWorkspace, {
      props: {
        loading: false,
        workspace: {
          subjectType: 'world', subjectId: '00000000-0000-4000-8000-000000000010', draft: null,
          activeVersion: {
            id: '00000000-0000-4000-8000-000000000001', subjectType: 'world',
            subjectId: '00000000-0000-4000-8000-000000000010', parentVersionId: null,
            status: 'published', snapshot, runtimeTokenCount: 10, tokenCounter: 'test',
            changeSummary: '初始版本', publishedAt: 1_000, createdAt: 1_000,
          },
          versions: [{
            id: '00000000-0000-4000-8000-000000000001', subjectType: 'world',
            subjectId: '00000000-0000-4000-8000-000000000010', parentVersionId: null,
            status: 'published', snapshot, runtimeTokenCount: 10, tokenCounter: 'test',
            changeSummary: '初始版本', publishedAt: 1_000, createdAt: 1_000,
          }],
        },
      },
    })

    expect(wrapper.text()).toContain('历史版本只读')
    await wrapper.findAll('button').find(button => button.text() === '修改灵魂')!.trigger('click')
    await flushPromises()
    const promptTextarea = document.querySelector<HTMLTextAreaElement>('[data-soul-prompt-form] textarea')
    expect(promptTextarea).toBeDefined()
    expect(promptTextarea!.value).toBe('当前灵魂提示词')
    await new DOMWrapper(promptTextarea!).setValue('  用户原始灵魂文本  ')
    const saveButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '保存修改稿')
    expect(saveButton).toBeDefined()
    await new DOMWrapper(saveButton!).trigger('click')
    await flushPromises()
    expect(wrapper.emitted('save')?.[0]).toEqual([{
      baseVersionId: '00000000-0000-4000-8000-000000000001',
      snapshot: { promptText: '用户原始灵魂文本' },
      autoAnalyze: false,
    }])
    expect(wrapper.emitted('publish')).toBeUndefined()

    const analyzeCheckbox = document.querySelector<HTMLElement>('[data-soul-auto-analyze]')
    expect(analyzeCheckbox).toBeDefined()
    await new DOMWrapper(analyzeCheckbox!).trigger('click')
    const analyzeButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '分析并保存修改稿')
    expect(analyzeButton).toBeDefined()
    await new DOMWrapper(analyzeButton!).trigger('click')
    await flushPromises()
    expect(wrapper.emitted('save')?.[1]?.[0]).toMatchObject({ autoAnalyze: true })
    expect(wrapper.emitted('publish')).toBeUndefined()

    await wrapper.findAll('button').find(button => button.text() === '复制为修改稿')!.trigger('click')
    expect(wrapper.emitted('from-version')).toEqual([['00000000-0000-4000-8000-000000000001']])
    expect(wrapper.emitted('publish')).toBeUndefined()
  })

  it('人物与世界共用资料区使用新标签页查看资料，并确认启停与解除关联', async () => {
    const linkedSource = {
      id: '00000000-0000-4000-8000-000000000001', name: '现有资料', role: 'canon_fact' as const,
      inputType: 'paste' as const, contentHash: 'a'.repeat(64), contentText: '已加入正文', originalFilePath: null,
      isEnabled: true, chunkCount: 1, linkCount: 1, createdAt: 1_000, updatedAt: 1_000,
    }
    const availableSource = {
      ...linkedSource,
      id: '00000000-0000-4000-8000-000000000002', name: '待加入资料', role: 'reference' as const,
      contentText: '待加入正文', linkCount: 0,
    }
    const wrapper = await mountSuspended(SubjectSourceManager, {
      props: {
        subjectType: 'persona', subjectName: '档案员', linkedSources: [linkedSource],
        allSources: [linkedSource, availableSource], loading: false, errorMessage: null,
      },
    })

    expect(wrapper.text()).toContain('解除关联不会删除资料本身')
    const detailsLink = wrapper.get('a[aria-label="查看资料详情：现有资料"]')
    expect(detailsLink.attributes()).toMatchObject({
      href: `/sources/${linkedSource.id}`,
      target: '_blank',
      rel: 'noopener noreferrer',
    })
    await wrapper.get('button[aria-label="禁用资料：现有资料"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('status')).toBeUndefined()
    expect(document.body.textContent).toContain('确认禁用资料')
    const confirmDisableButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认禁用')
    expect(confirmDisableButton).toBeDefined()
    await new DOMWrapper(confirmDisableButton!).trigger('click')
    await flushPromises()
    expect(wrapper.emitted('status')).toEqual([[{ sourceId: linkedSource.id, isEnabled: false }]])

    await wrapper.setProps({ linkedSources: [{ ...linkedSource, isEnabled: false }] })
    await wrapper.get('button[aria-label="启用资料：现有资料"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('status')).toHaveLength(1)
    expect(document.body.textContent).toContain('确认启用资料')
    const confirmEnableButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认启用')
    expect(confirmEnableButton).toBeDefined()
    await new DOMWrapper(confirmEnableButton!).trigger('click')
    await flushPromises()
    expect(wrapper.emitted('status')?.[1]).toEqual([{ sourceId: linkedSource.id, isEnabled: true }])

    await wrapper.findAll('button').find(button => button.text() === '导入资料')!.trigger('click')
    await flushPromises()
    const sourcePicker = document.querySelector<HTMLInputElement>('input[aria-label="选择已有资料"]')
    expect(sourcePicker).toBeDefined()
    await new DOMWrapper(sourcePicker!).setValue('待加入')
    await flushPromises()
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find(element => element.textContent?.includes('待加入资料'))
    expect(option).toBeDefined()
    await new DOMWrapper(option!).trigger('click')
    await flushPromises()
    const importButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '加入所选资料')
    expect(importButton).toBeDefined()
    await new DOMWrapper(importButton!).trigger('click')
    await wrapper.get('button[aria-label="解除资料关联：现有资料"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('unlink')).toBeUndefined()
    expect(document.body.textContent).toContain('确认解除资料关联')
    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认解除')
    expect(confirmButton).toBeDefined()
    await new DOMWrapper(confirmButton!).trigger('click')

    expect(wrapper.emitted('link')).toEqual([[[availableSource.id]]])
    expect(wrapper.emitted('unlink')).toEqual([[linkedSource.id]])

    await wrapper.findAll('button').find(button => button.text() === '新建资料')!.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('创建后会自动加入当前人物“档案员”')
    const createModal = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
      .find(element => element.textContent?.includes('新建资料'))
    expect(createModal).toBeDefined()
    const createForms = createModal!.querySelectorAll('form')
    const createName = createForms[0]!.querySelector<HTMLInputElement>('input[type="text"]')
    const createContent = createForms[0]!.querySelector<HTMLTextAreaElement>('textarea')
    expect(createName).toBeDefined()
    expect(createContent).toBeDefined()
    await new DOMWrapper(createName!).setValue('新建人物资料')
    await new DOMWrapper(createContent!).setValue('创建后应由详情页固定关联当前人物。')
    await new DOMWrapper(createForms[0]!).trigger('submit')
    await flushPromises()
    expect(wrapper.emitted('paste')?.[0]?.[0]).toEqual(expect.objectContaining({ name: '新建人物资料' }))

    await wrapper.setProps({ loading: true })
    await wrapper.setProps({ loading: false, errorMessage: null })
    await flushPromises()
    expect([...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
      .some(element => element.textContent?.includes('新建资料'))).toBe(false)

    await wrapper.findAll('button').find(button => button.text() === '新建资料')!.trigger('click')
    await flushPromises()
    const reopenedCreateModal = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
      .find(element => element.textContent?.includes('新建资料'))
    expect(reopenedCreateModal?.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('')
    expect(reopenedCreateModal?.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('')
  })

  it('文件资料表单要求用户明确选择文件', async () => {
    const wrapper = await mountSuspended(SourceImportForm, {
      props: { loading: false, errorMessage: null },
    })
    const forms = wrapper.findAll('form')
    await forms[1]!.trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('file')).toBeUndefined()
    expect(wrapper.text()).toContain('必须至少选择一个 TXT 或 Markdown 文件')
  })

  it('顶部对象选择由文本和多文件表单共用，并允许逐个修改默认资料名称', async () => {
    const personaId = '00000000-0000-4000-8000-000000000011'
    const worldId = '00000000-0000-4000-8000-000000000012'
    const wrapper = await mountSuspended(SourceImportForm, {
      props: {
        loading: false,
        errorMessage: null,
        showTargetPicker: true,
        personas: [{
          id: personaId, worldId: null, worldName: null, name: '档案员', origin: 'original', activeVersionId: null,
          currentSummary: null, versionCount: 0, sourceCount: 0, createdAt: 1_000, updatedAt: 1_000,
        }],
        worlds: [{
          id: worldId, name: '浮岛纪元', summary: '', activeVersionId: null, currentContent: null,
          versionCount: 0, personaCount: 0, sourceCount: 0, createdAt: 1_000, updatedAt: 1_000,
        }],
      },
    })
    const files = [
      new File(['第一份'], '事实.md', { type: 'text/markdown', lastModified: 1 }),
      new File(['第二份'], '风格.txt', { type: 'text/plain', lastModified: 2 }),
    ]
    const fileInput = wrapper.get('input[type="file"]')
    Object.defineProperty(fileInput.element, 'files', { configurable: true, value: files })
    await fileInput.trigger('change')
    await flushPromises()

    const fileNameInputs = wrapper.get('[aria-label="待导入文件"]').findAll('input[type="text"]')
    expect(fileNameInputs.map(input => (input.element as HTMLInputElement).value)).toEqual(['事实', '风格'])
    await fileNameInputs[1]!.setValue('人物表达样例')
    expect(wrapper.findAll('select[multiple]')).toHaveLength(0)
    await selectSourceTarget(wrapper, '档案', '人物 · 档案员')
    await selectSourceTarget(wrapper, '浮岛', '世界 · 浮岛纪元')
    expect(wrapper.text()).toContain('人物 · 档案员')
    expect(wrapper.text()).toContain('世界 · 浮岛纪元')
    const tagDeleteButtons = wrapper.findAll('[data-slot="tagsItemDelete"]')
    expect(tagDeleteButtons).toHaveLength(2)
    await tagDeleteButtons[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('人物 · 档案员')
    await selectSourceTarget(wrapper, '档案', '人物 · 档案员')
    await wrapper.findAll('form')[0]!.get('input[type="text"]').setValue('共享对象文本')
    await wrapper.get('textarea').setValue('文本和文件使用相同对象。')
    await wrapper.findAll('form')[0]!.trigger('submit')
    await wrapper.findAll('form')[1]!.trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('paste')).toEqual([[
      expect.objectContaining({
        name: '共享对象文本',
        targets: expect.arrayContaining([
          { targetType: 'persona', targetId: personaId },
          { targetType: 'world', targetId: worldId },
        ]),
      }),
    ]])
    expect(wrapper.emitted('file')).toEqual([[
      {
        role: 'reference',
        targets: expect.arrayContaining([
          { targetType: 'persona', targetId: personaId },
          { targetType: 'world', targetId: worldId },
        ]),
        files: [
          { file: files[0], name: '事实' },
          { file: files[1], name: '人物表达样例' },
        ],
      },
    ]])
  })

  it('粘贴文本不选择对象时仍可只保存到资料库', async () => {
    const wrapper = await mountSuspended(SourceImportForm, {
      props: { loading: false, errorMessage: null, showTargetPicker: true, personas: [], worlds: [] },
    })
    await wrapper.findAll('form')[0]!.get('input[type="text"]').setValue('独立资料')
    await wrapper.get('textarea').setValue('这份资料暂时不属于任何人物或世界。')
    await wrapper.findAll('form')[0]!.trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('paste')).toEqual([[
      expect.objectContaining({ name: '独立资料', targets: [] }),
    ]])
  })
})
