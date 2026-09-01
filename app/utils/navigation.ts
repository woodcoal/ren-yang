/** 后台导航项。 */
export interface AppNavigationItem {
  /** 面向用户的页面名称。 */
  label: string
  /** Nuxt 页面路由。 */
  to: string
  /** Lucide 图标名称。 */
  icon: string
}

/** 后台导航分组。 */
export interface AppNavigationGroup {
  /** 分组名称。 */
  label: string
  /** 分组内可直接访问的页面。 */
  items: AppNavigationItem[]
}

/** 页面头部使用的导航上下文。 */
export interface PageRouteContext {
  /** 当前页面所属导航分组。 */
  section: string
}

/** 后台统一侧栏导航定义。 */
export const appNavigationGroups: AppNavigationGroup[] = [
  {
    label: '工作台',
    items: [
      { label: '今日工作', to: '/', icon: 'i-lucide-house' },
      { label: '新建任务', to: '/workbench', icon: 'i-lucide-square-pen' },
      { label: '任务记录', to: '/history', icon: 'i-lucide-history' },
    ],
  },
  {
    label: '人物空间',
    items: [
      { label: '人物', to: '/personas', icon: 'i-lucide-users-round' },
      { label: '世界', to: '/worlds', icon: 'i-lucide-globe-2' },
      { label: '资料库', to: '/sources', icon: 'i-lucide-library' },
    ],
  },
  {
    label: '系统',
    items: [
      { label: '模型配置', to: '/ai-models', icon: 'i-lucide-server-cog' },
      { label: '算法配置', to: '/ai-algorithms', icon: 'i-lucide-workflow' },
      { label: '系统中心', to: '/settings', icon: 'i-lucide-settings-2' },
      { label: 'API Key', to: '/api-keys', icon: 'i-lucide-key-round' },
      { label: '日志与审计', to: '/system-records', icon: 'i-lucide-scroll-text' },
    ],
  },
]

/** 动态详情页到导航分组的映射。 */
const routeSectionRules: Array<{ prefix: string, section: string }> = [
  { prefix: '/runs/', section: '工作台' },
  { prefix: '/interest-batches/', section: '工作台' },
  { prefix: '/personas/new', section: '人物空间' },
  { prefix: '/personas/', section: '人物空间' },
  { prefix: '/worlds/', section: '人物空间' },
  { prefix: '/sources/', section: '人物空间' },
]

/** 未直接出现在侧栏中的固定页面标题。 */
const standalonePageTitles: Record<string, string> = {
  '/login': '登录',
  '/setup': '首次设置',
  '/personas/new': '新建人物',
  '/sources/search': '资料段落搜索',
  '/ai-settings': 'AI 管理',
  '/prompts': '提示词管理',
  '/system-ai-settings': 'AI 管理',
}

/** 动态详情页使用的稳定浏览器标题。 */
const dynamicPageTitleRules: Array<{ prefix: string, title: string }> = [
  { prefix: '/runs/', title: '任务详情' },
  { prefix: '/interest-batches/', title: '兴趣批次详情' },
  { prefix: '/personas/', title: '人物详情' },
  { prefix: '/worlds/', title: '世界详情' },
  { prefix: '/sources/', title: '资料详情' },
]

/**
 * 判断导航项是否与当前路由匹配。
 * @param currentPath 当前 Nuxt 路由路径。
 * @param targetPath 导航项的目标路由。
 * @returns 首页仅精确匹配，其他列表页同时匹配其详情子路由。
 */
export function isNavigationItemActive(currentPath: string, targetPath: string): boolean {
  if (targetPath === '/') return currentPath === '/'
  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`)
}

/**
 * 生成页面头部所需的导航分组。
 * @param currentPath 当前 Nuxt 路由路径，可能包含具体对象标识。
 * @returns 当前页面所属的导航分组。
 */
export function getPageRouteContext(currentPath: string): PageRouteContext {
  const dynamicRule = routeSectionRules.find(rule => currentPath.startsWith(rule.prefix))
  if (dynamicRule) return { section: dynamicRule.section }

  for (const group of appNavigationGroups) {
    const item = group.items.find(candidate => candidate.to === currentPath)
    if (item) return { section: group.label }
  }

  return { section: '工作台' }
}

/**
 * 获取当前路由的简洁浏览器标题。
 * @param currentPath 当前 Nuxt 路由路径，不包含查询参数。
 * @returns 侧栏页面名称、独立页面名称或动态详情页名称；未知页面返回通用名称。
 */
export function getPageDocumentTitle(currentPath: string): string {
  const navigationItem = appNavigationGroups
    .flatMap(group => group.items)
    .find(item => item.to === currentPath)
  if (navigationItem) return navigationItem.label

  const standaloneTitle = standalonePageTitles[currentPath]
  if (standaloneTitle) return standaloneTitle

  const dynamicRule = dynamicPageTitleRules.find(rule => currentPath.startsWith(rule.prefix))
  return dynamicRule?.title ?? '页面'
}
