<script setup lang="ts">
import type { PublicTaskQueueStatus } from '#shared/types/system'

/** 应用顶部工具栏的只读属性。 */
interface Props {
  /** 桌面侧栏是否处于折叠状态。 */
  sidebarCollapsed: boolean
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
    </div>

    <div class="topbar-end">
      <NuxtLink to="/history" class="topbar-status-link">
        <span class="topbar-status-dot" :class="{ 'topbar-status-dot--active': taskQueue?.userQueued }" aria-hidden="true" />
        <span>{{ taskQueue?.userQueued ? `${taskQueue.userQueued} 项待处理` : '暂无待处理任务' }}</span>
      </NuxtLink>
      <ShellThemeSelector />
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
  </header>
</template>
