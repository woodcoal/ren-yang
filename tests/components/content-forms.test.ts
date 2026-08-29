import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import PersonaDraftAssistant from '../../app/components/content/PersonaDraftAssistant.vue'
import PersonaForm from '../../app/components/content/PersonaForm.vue'
import SourceImportForm from '../../app/components/content/SourceImportForm.vue'
import WorldForm from '../../app/components/content/WorldForm.vue'
import WorldSourceManager from '../../app/components/content/WorldSourceManager.vue'
import WorldVersionHistory from '../../app/components/content/WorldVersionHistory.vue'

describe('阶段二内容表单', () => {
  it('原创人物在没有世界和资料时仍可提交初始候选档案', async () => {
    const wrapper = await mountSuspended(PersonaForm, {
      props: { worlds: [], sources: [], loading: false, errorMessage: null },
    })
    const inputs = wrapper.findAll('input')
    const textareas = wrapper.findAll('textarea')
    await inputs[0]!.setValue('林默')
    await textareas[0]!.setValue('谨慎的档案管理员')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('submit')).toEqual([[
      expect.objectContaining({
        name: '林默',
        origin: 'original',
        worldId: null,
        sourceIds: [],
        snapshot: expect.objectContaining({ summary: '谨慎的档案管理员' }),
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
        summary: '谨慎的档案管理员', identityFacts: '', interests: '古代文献', valuesAndMotivations: '重视证据',
        expressionStyle: '冷静简洁', appearance: '', visualStyle: '', constraints: '未知事实必须说明不知道',
      },
      changeSummary: '根据自然语言生成初始候选档案',
    }
    const wrapper = await mountSuspended(PersonaForm, {
      props: { worlds: [], sources: [], loading: false, errorMessage: null, initialValue },
    })
    await flushPromises()

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect((wrapper.findAll('input')[0]!.element as HTMLInputElement).value).toBe('林默')
    expect((wrapper.findAll('textarea')[7]!.element as HTMLTextAreaElement).value).toBe('未知事实必须说明不知道')
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
    expect(wrapper.text()).toContain('世界设定正文不能为空')
    expect(wrapper.text()).toContain('简短说明')
    expect(wrapper.text()).toContain('这部分会提供给关联人物的新任务')
  })

  it('世界修改记录要求二次确认后才提交版本删除', async () => {
    const wrapper = await mountSuspended(WorldVersionHistory, {
      props: {
        activeVersionId: '00000000-0000-4000-8000-000000000001',
        loading: false,
        versions: [
          {
            id: '00000000-0000-4000-8000-000000000002', worldId: '00000000-0000-4000-8000-000000000010',
            parentVersionId: '00000000-0000-4000-8000-000000000001', status: 'candidate', snapshot: { content: '错误正文' },
            changeSummary: '错误修改稿', publishedAt: null, createdAt: 2_000,
          },
          {
            id: '00000000-0000-4000-8000-000000000001', worldId: '00000000-0000-4000-8000-000000000010',
            parentVersionId: null, status: 'published', snapshot: { content: '当前正文' },
            changeSummary: '初始版本', publishedAt: 1_000, createdAt: 1_000,
          },
        ],
      },
    })

    expect(wrapper.text()).toContain('只有标记为“正在使用”的版本会用于人物的新任务')
    await wrapper.get('button[aria-label="删除"]').trigger('click')
    expect(wrapper.emitted('delete')).toBeUndefined()
    await wrapper.get('button[role="checkbox"]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '永久删除')!.trigger('click')

    expect(wrapper.emitted('delete')).toEqual([['00000000-0000-4000-8000-000000000002']])
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
    const textInputs = wrapper.findAll('input[type="text"]')
    await textInputs[1]!.setValue('人物资料')
    await forms[1]!.trigger('submit')
    await flushPromises()

    expect(wrapper.emitted('file')).toBeUndefined()
    expect(wrapper.text()).toContain('必须选择一个 TXT 或 Markdown 文件')
  })
})
