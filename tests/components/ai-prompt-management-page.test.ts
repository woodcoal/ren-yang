import { readBody } from 'h3'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { SaveAiPromptDraftInput } from '#shared/schemas/aiPrompt'
import type { AiPromptWorkspaceView } from '#shared/types/aiPrompt'
import AiPromptManagementPage from '../../app/pages/prompts.vue'

/** 测试使用的固定世界草稿版本标识。 */
const WORLD_VERSION_ID = '10000000-0000-4000-8000-000000000001'
/** 测试使用的固定历史版本标识。 */
const HISTORY_VERSION_ID = '10000000-0000-4000-8000-000000000002'
/** 测试使用的固定草稿标识。 */
const DRAFT_ID = '20000000-0000-4000-8000-000000000001'
/** 每个测试独享并可由模拟接口更新的提示词工作区。 */
let promptWorkspaces: AiPromptWorkspaceView[] = []
/** 测试捕获的草稿保存请求。 */
let savedDrafts: SaveAiPromptDraftInput[] = []
/** 测试捕获的发布请求次数。 */
let publishCount = 0

/**
 * 创建每个测试开始时使用的提示词目录。
 * @returns 包含文本提示词和图片提示词的独立工作区数据。
 */
function createPromptWorkspaces(): AiPromptWorkspaceView[] {
  return [
    {
      code: 'generation.world_draft',
      name: '世界草稿',
      category: '内容生成',
      description: '根据用户输入生成世界草稿。',
      kind: 'text',
      variables: [{ name: 'promptJson', label: '世界输入', description: '用户提交的世界设定 JSON。' }],
      activeVersion: {
        id: WORLD_VERSION_ID,
        promptCode: 'generation.world_draft',
        versionNo: 2,
        systemPromptTemplate: '当前系统规则',
        userPromptTemplate: '<世界>{{promptJson}}</世界>',
        changeSummary: '当前发布版本',
        publishedAt: 2_000,
      },
      draft: null,
      versions: [
        {
          id: WORLD_VERSION_ID,
          promptCode: 'generation.world_draft',
          versionNo: 2,
          systemPromptTemplate: '当前系统规则',
          userPromptTemplate: '<世界>{{promptJson}}</世界>',
          changeSummary: '当前发布版本',
          publishedAt: 2_000,
        },
        {
          id: HISTORY_VERSION_ID,
          promptCode: 'generation.world_draft',
          versionNo: 1,
          systemPromptTemplate: '历史系统规则',
          userPromptTemplate: '<历史世界>{{promptJson}}</历史世界>',
          changeSummary: '初始版本',
          publishedAt: 1_000,
        },
      ],
      updatedAt: 2_000,
    },
    {
      code: 'content.persona_avatar',
      name: '人物头像',
      category: '视觉生成',
      description: '根据人物资料生成头像。',
      kind: 'image',
      variables: [{ name: 'personaJson', label: '人物资料', description: '人物结构化资料。' }],
      activeVersion: {
        id: '10000000-0000-4000-8000-000000000003',
        promptCode: 'content.persona_avatar',
        versionNo: 1,
        systemPromptTemplate: null,
        userPromptTemplate: '头像：{{personaJson}}',
        changeSummary: '初始版本',
        publishedAt: 1_000,
      },
      draft: null,
      versions: [],
      updatedAt: 1_000,
    },
  ]
}

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))

registerEndpoint('/api/v1/ai-prompts', () => ({ data: promptWorkspaces }))

registerEndpoint('/api/v1/ai-prompts/generation.world_draft/draft', {
  method: 'PUT',
  /**
   * 保存测试页面提交的草稿并更新后续刷新结果。
   * @param event Nuxt 测试服务器请求事件。
   * @returns 更新后的提示词工作区响应。
   */
  handler: async (event) => {
    const input = await readBody<SaveAiPromptDraftInput>(event)
    savedDrafts.push(input)
    promptWorkspaces[0] = {
      ...promptWorkspaces[0]!,
      draft: {
        id: DRAFT_ID,
        promptCode: 'generation.world_draft',
        ...input,
        updatedAt: 3_000,
      },
      updatedAt: 3_000,
    }
    return { data: promptWorkspaces[0] }
  },
})

registerEndpoint('/api/v1/ai-prompts/generation.world_draft/publish', {
  method: 'POST',
  /**
   * 模拟把当前草稿发布为不可变的新版本。
   * @returns 新发布版本响应。
   */
  handler: () => {
    publishCount += 1
    const workspace = promptWorkspaces[0]!
    const draft = workspace.draft!
    const published = {
      id: '10000000-0000-4000-8000-000000000004',
      promptCode: workspace.code,
      versionNo: 3,
      systemPromptTemplate: draft.systemPromptTemplate,
      userPromptTemplate: draft.userPromptTemplate,
      changeSummary: draft.changeSummary,
      publishedAt: 4_000,
    }
    promptWorkspaces[0] = {
      ...workspace,
      activeVersion: published,
      draft: null,
      versions: [published, ...workspace.versions],
      updatedAt: 4_000,
    }
    return { data: published }
  },
})

beforeEach(() => {
  promptWorkspaces = createPromptWorkspaces()
  savedDrafts = []
  publishCount = 0
  vi.stubGlobal('scrollTo', vi.fn())
})

describe('AI 提示词管理页', () => {
  it('展示固定目录、模板变量和不可变发布历史', async () => {
    const wrapper = await mountSuspended(AiPromptManagementPage, { route: '/prompts' })
    await flushPromises()

    expect(wrapper.text()).toContain('固定提示词2')
    expect(wrapper.text()).toContain('世界草稿')
    expect(wrapper.text()).toContain('人物头像')
    expect(wrapper.text()).toContain('{{promptJson}}')
    expect(wrapper.text()).toContain('世界输入：用户提交的世界设定 JSON。')
    expect(wrapper.text()).toContain('不可变版本记录')
    expect(wrapper.text()).toContain('初始版本')
  })

  it('保存草稿后经确认发布，并能把历史版本载入编辑器', async () => {
    const wrapper = await mountSuspended(AiPromptManagementPage, { route: '/prompts' })
    await flushPromises()

    const textareas = wrapper.findAll('textarea')
    await textareas[0]!.setValue('调整后的系统规则')
    await textareas[1]!.setValue('<世界资料>{{promptJson}}</世界资料>')
    await wrapper.get('input[name="changeSummary"]').setValue('校准世界草稿')
    await wrapper.get('form').trigger('submit')
    await vi.waitFor(() => expect(savedDrafts).toHaveLength(1))
    await flushPromises()

    expect(savedDrafts[0]).toMatchObject({
      baseVersionId: WORLD_VERSION_ID,
      systemPromptTemplate: '调整后的系统规则',
      userPromptTemplate: '<世界资料>{{promptJson}}</世界资料>',
      changeSummary: '校准世界草稿',
    })

    const publishButton = wrapper.findAllComponents({ name: 'UButton' })
      .find(button => button.text() === '发布新版本')!
    expect(publishButton.props('disabled')).toBe(false)
    await publishButton.trigger('click')
    await flushPromises()
    expect(publishCount).toBe(0)

    const confirmPublishButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === '确认发布')
    expect(confirmPublishButton).toBeDefined()
    await new DOMWrapper(confirmPublishButton!).trigger('click')
    await vi.waitFor(() => expect(publishCount).toBe(1))
    await vi.waitFor(() => expect(wrapper.text()).toContain('当前 v3'))

    const loadHistoryButton = wrapper.findAllComponents({ name: 'UButton' })
      .filter(button => button.text() === '载入编辑')
      .at(-1)!
    await loadHistoryButton.trigger('click')

    expect(wrapper.findAll('textarea')[0]!.element.value).toBe('历史系统规则')
    expect(wrapper.findAll('textarea')[1]!.element.value).toBe('<历史世界>{{promptJson}}</历史世界>')
    expect(wrapper.get('input[name="changeSummary"]').element.value).toBe('基于 v1 重新调整')
  })
})
