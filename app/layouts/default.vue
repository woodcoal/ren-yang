<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef } from 'vue'
import type { ApiResponse, AuthenticationSessionResult } from '#shared/types/api'
import type { SystemCapabilitiesResult, SystemHealthResult } from '#shared/types/system'
import { getApiErrorMessage } from '../utils/apiError'

const logoutLoading = shallowRef(false)
const logoutError = shallowRef<string | null>(null)
const sidebarCollapsed = shallowRef(false)
const mobileNavigationOpen = shallowRef(false)
const [{ data: sessionData }, { data: healthData, refresh: refreshHealth }, { data: capabilityData }] = await Promise.all([
  useFetch<ApiResponse<AuthenticationSessionResult>>('/api/v1/auth/session'),
  useFetch<ApiResponse<SystemHealthResult>>('/api/v1/system/health'),
  useFetch<ApiResponse<SystemCapabilitiesResult>>('/api/v1/system/capabilities'),
])
/** 全局任务数量刷新计时器。 */
const healthRefreshTimer = shallowRef<ReturnType<typeof setInterval> | null>(null)
/** 桌面侧栏状态的本机存储键。 */
const sidebarStorageKey = 'renyang.sidebar.collapsed'

/** @returns 启动低频健康状态刷新，避免布局持久存在时任务数量过期。 */
function startHealthRefresh(): void {
  if (healthRefreshTimer.value) return
  healthRefreshTimer.value = setInterval(() => { void refreshHealth() }, 5_000)
}

/** @returns 停止全局健康状态刷新并释放计时器。 */
function stopHealthRefresh(): void {
  if (!healthRefreshTimer.value) return
  clearInterval(healthRefreshTimer.value)
  healthRefreshTimer.value = null
}

/**
 * 从本机恢复侧栏偏好并启动健康状态刷新。
 * @returns 无返回值。
 */
function initializeLayout(): void {
  sidebarCollapsed.value = window.localStorage.getItem(sidebarStorageKey) === 'true'
  startHealthRefresh()
}

/**
 * 切换桌面侧栏宽度并保存到本机浏览器。
 * @returns 无返回值。
 */
function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value
  window.localStorage.setItem(sidebarStorageKey, String(sidebarCollapsed.value))
}

/**
 * 打开移动端导航抽屉。
 * @returns 无返回值。
 */
function openMobileNavigation(): void {
  mobileNavigationOpen.value = true
}

/**
 * 关闭移动端导航抽屉。
 * @returns 无返回值。
 */
function closeMobileNavigation(): void {
  mobileNavigationOpen.value = false
}

onMounted(initializeLayout)
onUnmounted(stopHealthRefresh)

/**
 * 清除当前管理员会话并返回登录页。
 * @returns 请求和导航结束时完成。
 */
async function logout(): Promise<void> {
  logoutLoading.value = true
  logoutError.value = null
  try {
    await $fetch('/api/v1/auth/logout', { method: 'POST' })
    await navigateTo('/login')
  }
  catch (error: unknown) {
    logoutError.value = getApiErrorMessage(error, '退出失败，请重试')
  }
  finally {
    logoutLoading.value = false
  }
}
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--collapsed': sidebarCollapsed }">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <ShellAppSidebar
      :collapsed="sidebarCollapsed"
      :mobile-open="mobileNavigationOpen"
      :username="sessionData?.data.administrator?.username || ''"
      :task-queue="healthData?.data.taskQueue || null"
      :capabilities="capabilityData?.data || null"
      @navigate="closeMobileNavigation"
    />
    <button
      v-if="mobileNavigationOpen"
      class="sidebar-backdrop"
      type="button"
      aria-label="关闭导航"
      @click="closeMobileNavigation"
    />

    <div class="app-main">
      <ShellAppTopbar
        :sidebar-collapsed="sidebarCollapsed"
        :username="sessionData?.data.administrator?.username || ''"
        :task-queue="healthData?.data.taskQueue || null"
        :logout-loading="logoutLoading"
        :logout-error="logoutError"
        @toggle-sidebar="toggleSidebar"
        @open-mobile-navigation="openMobileNavigation"
        @logout="logout"
      />
      <main id="main-content" class="app-page" tabindex="-1">
        <slot />
      </main>
    </div>
  </div>
</template>
