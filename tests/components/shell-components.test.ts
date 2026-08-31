import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import BrandMark from '../../app/components/brand/BrandMark.vue'
import PageHeader from '../../app/components/content/PageHeader.vue'
import AppTopbar from '../../app/components/shell/AppTopbar.vue'
import ThemeSelector from '../../app/components/shell/ThemeSelector.vue'
import { appNavigationGroups } from '../../app/utils/navigation'

describe('后台品牌与主题组件', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('品牌标志同时提供正式名称、副标题和可缩放矢量图形', async () => {
    const wrapper = await mountSuspended(BrandMark)

    expect(wrapper.text()).toContain('人样')
    expect(wrapper.text()).toContain('让它有个人样')
    expect(wrapper.find('svg[viewBox="0 0 24 24"]').exists()).toBe(true)
  })

  it('主题选择使用彩色图标并把偏好同步到根节点和本机存储', async () => {
    const wrapper = await mountSuspended(ThemeSelector)
    const select = wrapper.get('select[aria-label="界面主题"]')

    expect(select.findAll('option').map(option => option.text())).toEqual(['雾白', '暖砂', '海盐', '松岚'])
    expect(wrapper.get('[data-theme-icon]').attributes('data-theme-icon')).toBe('mist')
    await select.setValue('ocean')

    expect(document.documentElement.dataset.theme).toBe('ocean')
    expect(window.localStorage.getItem('renyang-theme')).toBe('ocean')
    expect(wrapper.get('[data-theme-icon]').attributes('data-theme-icon')).toBe('ocean')
    expect(wrapper.get('.theme-control').attributes('title')).toBe('界面主题：海盐')
  })

  it('顶部栏不再显示重复的页面搜索和用户信息', async () => {
    const wrapper = await mountSuspended(AppTopbar, {
      props: {
        sidebarCollapsed: false,
        taskQueue: null,
        logoutLoading: false,
        logoutError: null,
      },
    })

    expect(wrapper.text()).not.toContain('查找页面或功能')
    expect(wrapper.find('.topbar-command-button').exists()).toBe(false)
    expect(wrapper.find('.topbar-account').exists()).toBe(false)
  })

  it('页面标题保留面包屑但不再显示路由代码', async () => {
    const wrapper = await mountSuspended(PageHeader, {
      props: { title: '系统中心', description: '系统说明' },
    })

    expect(wrapper.get('nav[aria-label="面包屑"]').text()).toContain('系统中心')
    expect(wrapper.text()).not.toContain('ROUTE')
    expect(wrapper.find('.page-route-code').exists()).toBe(false)
  })

  it('页面标题允许在名称前展示对象图像', async () => {
    const wrapper = await mountSuspended(PageHeader, {
      props: { title: '林默', description: '人物说明' },
      slots: { leading: '<span data-page-heading-image>人物图像</span>' },
    })

    expect(wrapper.get('[data-page-heading-image]').text()).toBe('人物图像')
    expect(wrapper.get('.page-heading-identity').text()).toContain('林默')
  })

  it('系统菜单只保留三个集中 AI 管理入口', () => {
    const systemGroup = appNavigationGroups.find(group => group.label === '系统')

    expect(systemGroup?.items).toContainEqual({ label: 'AI 模型', to: '/ai-models', icon: 'i-lucide-server-cog' })
    expect(systemGroup?.items).toContainEqual({ label: 'AI 算法', to: '/ai-algorithms', icon: 'i-lucide-workflow' })
    expect(systemGroup?.items).toContainEqual({ label: 'AI 设置', to: '/ai-settings', icon: 'i-lucide-sliders-horizontal' })
    expect(systemGroup?.items).not.toContainEqual(expect.objectContaining({ to: '/prompts' }))
    expect(systemGroup?.items).not.toContainEqual(expect.objectContaining({ to: '/system-ai-settings' }))
    expect(systemGroup?.items).not.toContainEqual(expect.objectContaining({ to: '/parameter-profiles' }))
  })
})
