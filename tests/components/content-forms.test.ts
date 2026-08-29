import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PersonaDraftAssistant from '../../app/components/content/PersonaDraftAssistant.vue'
import PersonaForm from '../../app/components/content/PersonaForm.vue'
import SourceImportForm from '../../app/components/content/SourceImportForm.vue'
import WorldForm from '../../app/components/content/WorldForm.vue'
import WorldSourceManager from '../../app/components/content/WorldSourceManager.vue'
import SoulWorkspace from '../../app/components/content/SoulWorkspace.vue'

describe('阶段二内容表单', () => {
  it('原创人物在没有世界和资料时仍可提交初始候选档案', async () => {
    const wrapper = await mountSuspended(PersonaForm, {
      props: { worlds: [], sources: [], loading: false, errorMessage: null },
    })
    const inputs = wrapper.findAll('input')
    const textareas = wrapper.findAll('textarea')
    await inputs[0]!.setValue('林默')
    await textareas[0]!.setValue('谨慎的档案管理员')
    await textareas[1]!.setValue('谨慎的档案管理员，资料不足时说明未知。')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('submit')).toEqual([[
      expect.objectContaining({
        name: '林默',
        origin: 'original',
        worldId: null,
        sourceIds: [],
        snapshot: expect.objectContaining({
          chapters: [expect.objectContaining({ title: '核心人设', content: '谨慎的档案管理员' })],
          runtimeSummary: '谨慎的档案管理员，资料不足时说明未知。',
        }),
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
          contentText: '学院事实', originalFilePath: null, chunkCount: 1, linkCount: 0, createdAt: 1_000, updatedAt: 1_000,
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
      snapshot: {
        chapters: [{
          id: '00000000-0000-4000-8000-000000000001', title: '核心人设',
          content: '谨慎的档案管理员，喜欢古代文献并重视证据。', order: 0, required: true,
        }],
        runtimeSummary: '谨慎的档案管理员，冷静简洁，未知事实必须说明不知道。',
      },
      changeSummary: '根据自然语言生成初始候选档案',
    }
    const wrapper = await mountSuspended(PersonaForm, {
      props: { worlds: [], sources: [], loading: false, errorMessage: null, initialValue },
    })
    await flushPromises()

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect((wrapper.findAll('input')[0]!.element as HTMLInputElement).value).toBe('林默')
    expect((wrapper.findAll('textarea')[1]!.element as HTMLTextAreaElement).value).toBe(initialValue.snapshot.runtimeSummary)
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
    expect(wrapper.text()).toContain('章节正文不能为空')
    expect(wrapper.text()).toContain('运行摘要不能为空')
    expect(wrapper.text()).toContain('简短说明')
    expect(wrapper.text()).toContain('只有这里会进入新任务提示词')
  })

  it('灵魂历史版本只能复制为修改稿，发布动作与保存动作分开', async () => {
    const snapshot = {
      chapters: [{ id: '00000000-0000-4000-8000-000000000001', title: '规则', content: '当前正文', order: 0, required: true }],
      runtimeSummary: '当前摘要',
    }
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
    await wrapper.findAll('button').find(button => button.text() === '复制为修改稿')!.trigger('click')
    expect(wrapper.emitted('from-version')).toEqual([['00000000-0000-4000-8000-000000000001']])
    expect(wrapper.emitted('publish')).toBeUndefined()
  })

  it('世界资料区可直接加入已有资料或解除关联', async () => {
    const linkedSource = {
      id: '00000000-0000-4000-8000-000000000001', name: '现有资料', role: 'canon_fact' as const,
      inputType: 'paste' as const, contentHash: 'a'.repeat(64), contentText: '已加入正文', originalFilePath: null,
      chunkCount: 1, linkCount: 1, createdAt: 1_000, updatedAt: 1_000,
    }
    const availableSource = {
      ...linkedSource,
      id: '00000000-0000-4000-8000-000000000002', name: '待加入资料', role: 'reference' as const,
      contentText: '待加入正文', linkCount: 0,
    }
    const wrapper = await mountSuspended(WorldSourceManager, {
      props: { linkedSources: [linkedSource], allSources: [linkedSource, availableSource], loading: false, errorMessage: null },
    })

    expect(wrapper.text()).toContain('解除关联不会删除资料本身')
    await wrapper.findAll('button').find(button => button.text() === '加入')!.trigger('click')
    await wrapper.get('button[aria-label="从世界中移除资料"]').trigger('click')

    expect(wrapper.emitted('link')).toEqual([[availableSource.id]])
    expect(wrapper.emitted('unlink')).toEqual([[linkedSource.id]])
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

  it('多文件共用用途和关联对象，并允许逐个修改默认资料名称', async () => {
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
    const targetSelects = wrapper.findAll('select[multiple]')
    await targetSelects[2]!.setValue([personaId])
    await targetSelects[3]!.setValue([worldId])
    await wrapper.findAll('form')[1]!.trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('file')).toEqual([[
      {
        role: 'reference',
        targets: [
          { targetType: 'persona', targetId: personaId },
          { targetType: 'world', targetId: worldId },
        ],
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
    await wrapper.findAll('input[type="text"]')[0]!.setValue('独立资料')
    await wrapper.get('textarea').setValue('这份资料暂时不属于任何人物或世界。')
    await wrapper.findAll('form')[0]!.trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('paste')).toEqual([[
      expect.objectContaining({ name: '独立资料', targets: [] }),
    ]])
  })
})
