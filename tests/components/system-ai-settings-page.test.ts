import { readBody } from 'h3'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { SystemAiSettingsValues } from '../../shared/schemas/systemAi'
import AiSettingsPage from '../../app/pages/ai-settings.vue'
import WorkbenchPage from '../../app/pages/workbench.vue'

/** 测试页面读取与保存的完整系统 AI 参数。 */
const settings: SystemAiSettingsValues = {
  interestAnalysis: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000, maxEvidenceChunks: 8 },
  contentAnalysis: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 },
  draftGeneration: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000 },
  feedbackClassification: { temperature: 0, maxOutputTokens: 4_096, timeoutMs: 60_000 },
}

/** 系统 AI 保存接口最后收到的完整请求体。 */
let savedSettings: SystemAiSettingsValues | null = null

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/system/ai-settings', () => ({ data: { values: settings, updatedAt: null } }))
registerEndpoint('/api/v1/system/ai-settings', {
  method: 'PUT',
  /**
   * 记录页面提交的完整系统 AI 参数并模拟保存结果。
   * @param event Nuxt 测试服务器收到的设置保存请求。
   * @returns 带固定更新时间的成功响应。
   */
  handler: async (event) => {
    savedSettings = await readBody<SystemAiSettingsValues>(event)
    return { data: { values: savedSettings, updatedAt: 3_000 } }
  },
})
registerEndpoint('/api/v1/ai-prompts', () => ({ data: [] }))
registerEndpoint('/api/v1/ai/algorithms', () => ({ data: [] }))
registerEndpoint('/api/v1/personas', () => ({ data: [] }))
registerEndpoint('/api/v1/parameter-profiles', () => ({ data: [{
  id: '10000000-0000-4000-8000-000000000001', name: '图文方案', version: 1, values: {}, isActive: true, createdAt: 1_000,
}] }))
registerEndpoint('/api/v1/format-templates', () => ({ data: [] }))
registerEndpoint('/api/v1/system/capabilities', () => ({ data: {
  textModel: { configured: true, provider: 'openai_compatible', model: 'test', endpointOrigin: 'https://example.test' },
  imageModel: { configured: false, provider: 'openai_compatible_images', model: null, endpointOrigin: null },
  openViking: { configured: false, enabled: false }, contextProvider: 'sqlite_fts5',
} }))

beforeEach(() => {
  savedSettings = null
})

describe('AI 设置页面', () => {
  it('按业务选项卡展示四类参数并提交完整设置', async () => {
    const wrapper = await mountSuspended(AiSettingsPage, { route: '/ai-settings' })
    await flushPromises()

    expect(wrapper.text()).toContain('兴趣分析')
    await wrapper.findAll('button').find(button => button.text().includes('人物记忆'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('记忆提炼')
    await wrapper.findAll('button').find(button => button.text().includes('草稿生成'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('草稿生成')
    await wrapper.findAll('button').find(button => button.text().includes('反馈分类'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('反馈分类')
    expect(wrapper.text()).toContain('灵魂与成长提示词在 AI 算法中维护')

    await wrapper.get('form[data-system-ai-settings-form]').trigger('submit')
    await flushPromises()

    expect(savedSettings).toEqual(settings)
  })

  it('工作台仅在结构化图文创作模式显示生成设置', async () => {
    const wrapper = await mountSuspended(WorkbenchPage, { route: '/workbench' })
    await flushPromises()

    expect(wrapper.find('[aria-label="生成设置"]').exists()).toBe(false)
    await wrapper.get('[aria-label="任务类型"]').setValue('generation')
    expect(wrapper.find('[aria-label="生成设置"]').exists()).toBe(true)
  })
})
