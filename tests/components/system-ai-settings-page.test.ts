import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import AiSettingsPage from '../../app/pages/ai-settings.vue'
import PromptsPage from '../../app/pages/prompts.vue'
import WorkbenchPage from '../../app/pages/workbench.vue'

registerEndpoint('/api/v1/auth/session', () => ({
  data: { authenticated: true, administrator: { id: 'administrator', username: 'admin' } },
}))
registerEndpoint('/api/v1/personas', () => ({ data: [] }))
registerEndpoint('/api/v1/system/capabilities', () => ({ data: {
  textModel: { configured: true, provider: 'openai_compatible', model: 'test', endpointOrigin: 'https://example.test' },
  imageModel: { configured: false, provider: 'openai_compatible_images', model: null, endpointOrigin: null },
  algorithmCapabilities: { articleGeneration: true, articleImageGeneration: false, interestAssessment: true },
  openViking: { configured: false, enabled: false }, contextProvider: 'sqlite_fts5',
} }))

describe('统一 AI 管理入口', () => {
  it('旧 AI 设置入口直接跳转算法配置且不再展示独立设置表单', async () => {
    const wrapper = await mountSuspended(AiSettingsPage, { route: '/ai-settings' })
    await flushPromises()

    expect(wrapper.text()).toContain('原 AI 设置已由对应固定算法统一接管')
    expect(wrapper.find('form[data-system-ai-settings-form]').exists()).toBe(false)
    expect(wrapper.vm.$router.currentRoute.value.path).toBe('/ai-algorithms')
  })

  it('旧提示词入口直接跳转对应算法，不再分流到独立 AI 设置', async () => {
    const wrapper = await mountSuspended(PromptsPage, { route: '/prompts?code=generation.article' })
    await flushPromises()

    expect(wrapper.text()).toContain('生产调用使用的提示词已归入对应固定算法')
    expect(wrapper.vm.$router.currentRoute.value).toMatchObject({
      path: '/ai-algorithms',
      query: { prompt: 'generation.article' },
    })
  })

  it('工作台直接显示输出格式与图片数量且不暴露参数方案', async () => {
    const wrapper = await mountSuspended(WorkbenchPage, { route: '/workbench' })
    await flushPromises()

    expect(wrapper.find('[aria-label="生成设置"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="输出格式"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="图片数量"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('不经过大纲或规格确认')

    await wrapper.findAll('button').find(button => button.text().includes('批量判断人物是否感兴趣'))!.trigger('click')
    expect(wrapper.find('textarea[aria-label="附加提示词"]').exists()).toBe(true)
    expect(wrapper.find('textarea[aria-label="待判断文本 1"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('年龄阶段')
    expect(wrapper.text()).not.toContain('地点')
  })
})
