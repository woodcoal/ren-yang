<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import type { PublicTaskQueueStatus } from '#shared/types/system'
import { appNavigationGroups, appNavigationItems } from '../../utils/navigation'

/** 应用顶部工具栏的只读属性。 */
interface Props {
  /** 桌面侧栏是否处于折叠状态。 */
  sidebarCollapsed: boolean
  /** 当前管理员名称。 */
  username: string
  /** 后台任务队列摘要；首次加载时可以为空。 */
  taskQueue: PublicTaskQueueStatus | null
  /** 退出请求是否正在进行。 */
  logoutLoading: boolean
  /** 退出失败后的安全错误说明。 */
  logoutError: string | null
}

defineProps<Props>()

const emit = defineEmits<{
  /** 请求切换桌面侧栏宽度。 */
  toggleSidebar: []
  /** 请求打开移动导航。 */
  openMobileNavigation: []
  /** 请求退出当前管理员会话。 */
  logout: []
}>()

const commandOpen = shallowRef(false)
const commandQuery = shallowRef('')

/** 根据页面名称、分组和说明筛选导航命令。 */
const filteredNavigationItems = computed(() => {
  const query = commandQuery.value.trim().toLocaleLowerCase('zh-CN')
  if (!query) return appNavigationItems

  return appNavigationGroups.flatMap(group => group.items
    .filter(item => `${group.label} ${item.label} ${item.description}`.toLocaleLowerCase('zh-CN').includes(query)))
})

/**
 * 处理全局命令面板快捷键。
 * @param event 浏览器键盘事件。
 * @returns 无返回值。
 */
function handleGlobalShortcut(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== 'k') return
  event.preventDefault()
  commandOpen.value = true
}

/**
 * 关闭命令面板并进入选中的后台页面。
 * @param to 目标 Nuxt 页面路由。
 * @returns 页面导航完成时结束。
 */
async function navigateFromCommand(to: string): Promise<void> {
  commandOpen.value = false
  commandQuery.value = ''
  await navigateTo(to)
}

onMounted(() => window.addEventListener('keydown', handleGlobalShortcut))
onUnmounted(() => window.removeEventListener('keydown', handleGlobalShortcut))
</script>

<template>
  <header class="app-topbar">
    <div class="topbar-start">
      <UButton
        class="topbar-mobile-menu"
        color="neutral"
        variant="ghost"
        icon="i-lucide-menu"
        aria-label="打开导航"
        @click="emit('openMobileNavigation')"
      />
      <UButton
        class="topbar-sidebar-toggle"
        color="neutral"
        variant="ghost"
        :icon="sidebarCollapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
        :aria-label="sidebarCollapsed ? '展开侧栏' : '折叠侧栏'"
        :aria-pressed="sidebarCollapsed"
        @click="emit('toggleSidebar')"
      />
      <UButton
        class="topbar-command-button"
        color="neutral"
        variant="outline"
        icon="i-lucide-search"
        @click="commandOpen = true"
      >
        <span class="topbar-command-label">查找页面或功能</span>
        <kbd class="topbar-shortcut">Ctrl K</kbd>
      </UButton>
    </div>

    <div class="topbar-end">
      <NuxtLink to="/history" class="topbar-status-link">
        <span class="topbar-status-dot" :class="{ 'topbar-status-dot--active': taskQueue?.total }" aria-hidden="true" />
        <span>{{ taskQueue?.total ? `${taskQueue.total} 项后台任务` : '后台队列空闲' }}</span>
      </NuxtLink>
      <ShellThemeSelector />
      <UButton to="/settings" color="neutral" variant="ghost" icon="i-lucide-user-round" class="topbar-account">
        <span>{{ username || '管理员' }}</span>
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-log-out"
        :loading="logoutLoading"
        aria-label="退出登录"
        @click="emit('logout')"
      />
    </div>

    <p v-if="logoutError" class="topbar-error" role="alert">{{ logoutError }}</p>

    <UModal
      v-model:open="commandOpen"
      title="前往页面"
      description="搜索后台页面和现有功能，不会检索人物或资料正文。"
      :ui="{ content: 'max-w-2xl', body: 'p-0 sm:p-0' }"
    >
      <template #body>
        <div class="command-panel">
          <UInput
            v-model="commandQuery"
            autofocus
            icon="i-lucide-search"
            placeholder="输入页面或功能名称"
            aria-label="搜索后台页面"
            class="w-full"
          />
          <nav class="command-results" aria-label="可访问页面">
            <button
              v-for="item in filteredNavigationItems"
              :key="item.to"
              type="button"
              class="command-result"
              @click="navigateFromCommand(item.to)"
            >
              <UIcon :name="item.icon" class="command-result-icon" aria-hidden="true" />
              <span class="command-result-copy">
                <strong>{{ item.label }}</strong>
                <span>{{ item.description }}</span>
              </span>
              <code>{{ item.to }}</code>
            </button>
            <p v-if="!filteredNavigationItems.length" class="command-empty">没有匹配的页面。</p>
          </nav>
        </div>
      </template>
    </UModal>
  </header>
</template>
