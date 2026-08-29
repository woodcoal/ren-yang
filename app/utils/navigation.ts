/** 后台导航项。 */
export interface AppNavigationItem {
  /** 面向用户的页面名称。 */
  label: string
  /** Nuxt 页面路由。 */
  to: string
  /** Lucide 图标名称。 */
  icon: string
  /** 用于命令导航的简短说明。 */
  description: string
}

/** 后台导航分组。 */
export interface AppNavigationGroup {
  /** 分组名称。 */
  label: string
  /** 分组内可直接访问的页面。 */
  items: AppNavigationItem[]
}

/** 页面头部使用的路由上下文。 */
export interface PageRouteContext {
  /** 当前页面所属导航分组。 */
  section: string
  /** 去除具体标识后的稳定路由。 */
  routeCode: string
}

/** 后台统一导航定义，供侧栏与命令导航复用。 */
export const appNavigationGroups: AppNavigationGroup[] = [
  {
    label: '工作台',
    items: [
      { label: '今日工作', to: '/', icon: 'i-lucide-house', description: '查看待处理事项、活动任务与系统异常' },
      { label: '新建任务', to: '/workbench', icon: 'i-lucide-square-pen', description: '发起人物兴趣判断或图文创作任务' },
      { label: '任务记录', to: '/history', icon: 'i-lucide-history', description: '查找历史任务并继续处理' },
    ],
  },
  {
    label: '人物空间',
    items: [
      { label: '人物', to: '/personas', icon: 'i-lucide-users-round', description: '管理人物设定、版本和关联资料' },
      { label: '世界设定', to: '/worlds', icon: 'i-lucide-globe-2', description: '管理多个人物共用的背景与规则' },
      { label: '资料库', to: '/sources', icon: 'i-lucide-library', description: '导入、查找并维护参考资料' },
    ],
  },
  {
    label: '学习与复盘',
    items: [
      { label: '学习中心', to: '/feedback', icon: 'i-lucide-message-square-more', description: '查看反馈记录并维护人物回归用例' },
    ],
  },
  {
    label: '系统',
    items: [
      { label: '内容模板', to: '/templates', icon: 'i-lucide-panels-top-left', description: '管理输出结构与内容格式版本' },
      { label: '生成设置', to: '/parameter-profiles', icon: 'i-lucide-sliders-horizontal', description: '管理模型参数和资源限制版本' },
      { label: '系统中心', to: '/settings', icon: 'i-lucide-settings-2', description: '查看模型、检索、备份和审计状态' },
    ],
  },
]

/** 扁平导航项，供命令导航检索使用。 */
export const appNavigationItems = appNavigationGroups.flatMap(group => group.items)

/** 动态详情页到导航分组的映射。 */
const routeSectionRules: Array<{ prefix: string, section: string, routeCode: string }> = [
  { prefix: '/runs/', section: '工作台', routeCode: '/runs/[id]' },
  { prefix: '/personas/new', section: '人物空间', routeCode: '/personas/new' },
  { prefix: '/personas/', section: '人物空间', routeCode: '/personas/[id]' },
  { prefix: '/worlds/', section: '人物空间', routeCode: '/worlds/[id]' },
  { prefix: '/sources/', section: '人物空间', routeCode: '/sources/[id]' },
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
 * 生成页面头部所需的导航分组和稳定路由标识。
 * @param currentPath 当前 Nuxt 路由路径，可能包含具体对象标识。
 * @returns 不暴露具体 UUID 的页面路由上下文。
 */
export function getPageRouteContext(currentPath: string): PageRouteContext {
  const dynamicRule = routeSectionRules.find(rule => currentPath.startsWith(rule.prefix))
  if (dynamicRule) return { section: dynamicRule.section, routeCode: dynamicRule.routeCode }

  for (const group of appNavigationGroups) {
    const item = group.items.find(candidate => candidate.to === currentPath)
    if (item) return { section: group.label, routeCode: item.to }
  }

  return { section: '工作台', routeCode: currentPath }
}
