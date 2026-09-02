import { beforeEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import BrandMark from '../../app/components/brand/BrandMark.vue'
import PageHeader from '../../app/components/content/PageHeader.vue'
import AppSidebar from '../../app/components/shell/AppSidebar.vue'
import AppTopbar from '../../app/components/shell/AppTopbar.vue'
import ThemeSelector from '../../app/components/shell/ThemeSelector.vue'
import { appNavigationGroups, getPageDocumentTitle } from '../../app/utils/navigation'

describe('后台品牌与主题组件', () => {
  beforeEach(() => {
    window.localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('品牌标志同时提供正式名称、副标题和可缩放矢量图形', async () => {
    const wrapper = await mountSuspended(BrandMark)

    expect(wrapper.text()).toContain('人样')
    expect(wrapper.text()).toContain('Agents, with a human touch.')
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

  it('顶部栏显示包含排队、执行和取消中状态的全部活动任务数量', async () => {
    const wrapper = await mountSuspended(AppTopbar, {
      props: {
        sidebarCollapsed: false,
        taskQueue: { userQueued: 2, queued: 12, running: 3, cancelRequested: 1, total: 16 },
        logoutLoading: false,
        logoutError: null,
      },
    })

    expect(wrapper.get('.topbar-status-link').text()).toBe('16 项活动任务')
    expect(wrapper.get('.topbar-status-dot').classes()).toContain('topbar-status-dot--active')
  })

  it('侧栏菜单分组默认只展开当前分组并允许独立切换', async () => {
    const wrapper = await mountSuspended(AppSidebar, {
      props: {
        collapsed: false,
        mobileOpen: false,
        username: 'admin',
        taskQueue: null,
        capabilities: null,
      },
    })
    const toggles = wrapper.findAll('.sidebar-navigation-title')

    expect(toggles.map(toggle => toggle.attributes('aria-expanded'))).toEqual(['true', 'false', 'false'])
    expect(wrapper.findAll('.sidebar-navigation-items--expanded')).toHaveLength(1)

    await toggles[1]!.trigger('click')

    expect(toggles[1]!.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.sidebar-navigation-items--expanded')).toHaveLength(2)
  })

  it('侧栏任务记录显示包含排队、执行和取消中状态的全部活动任务数量', async () => {
    const wrapper = await mountSuspended(AppSidebar, {
      props: {
        collapsed: false,
        mobileOpen: false,
        username: 'admin',
        taskQueue: { userQueued: 2, queued: 12, running: 3, cancelRequested: 1, total: 16 },
        capabilities: null,
      },
    })

    expect(wrapper.get('a[href="/history"] .sidebar-navigation-count').text()).toBe('16')
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

  it('系统菜单分别提供模型配置与算法配置入口', () => {
    const systemGroup = appNavigationGroups.find(group => group.label === '系统')

    expect(systemGroup?.items).toContainEqual({ label: '模型配置', to: '/ai-models', icon: 'i-lucide-server-cog' })
    expect(systemGroup?.items).toContainEqual({ label: '算法配置', to: '/ai-algorithms', icon: 'i-lucide-workflow' })
    expect(systemGroup?.items).not.toContainEqual(expect.objectContaining({ to: '/ai-settings' }))
    expect(systemGroup?.items).not.toContainEqual(expect.objectContaining({ to: '/prompts' }))
    expect(systemGroup?.items).not.toContainEqual(expect.objectContaining({ to: '/system-ai-settings' }))
    expect(systemGroup?.items).not.toContainEqual(expect.objectContaining({ to: '/parameter-profiles' }))
  })

  it('所有页面类型都能生成明确的浏览器标题', () => {
    const pagePaths = [
      '/', '/workbench', '/history', '/personas', '/personas/new', '/personas/persona-1',
      '/worlds', '/worlds/world-1', '/sources', '/sources/search', '/sources/source-1',
      '/runs/run-1', '/interest-batches/batch-1', '/ai-models', '/ai-algorithms', '/ai-settings', '/settings',
      '/system-records', '/login', '/setup', '/prompts', '/system-ai-settings',
    ]

    expect(pagePaths.map(getPageDocumentTitle)).not.toContain('页面')
    expect(getPageDocumentTitle('/')).toBe('今日工作')
    expect(getPageDocumentTitle('/login')).toBe('登录')
    expect(getPageDocumentTitle('/personas/persona-1')).toBe('人物详情')
    expect(getPageDocumentTitle('/sources/search')).toBe('资料段落搜索')
    expect(getPageDocumentTitle('/runs/run-1')).toBe('任务详情')
    expect(getPageDocumentTitle('/interest-batches/batch-1')).toBe('兴趣批次详情')
  })
})
