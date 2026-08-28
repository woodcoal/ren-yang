<script setup lang="ts">
import { shallowRef } from 'vue'
import { getApiErrorMessage } from '../utils/apiError'

/** 工作台主导航。 */
const navigation = [
  { label: '仪表盘', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: '创作', to: '/workbench', icon: 'i-lucide-sparkles' },
  { label: '运行历史', to: '/history', icon: 'i-lucide-history' },
  { label: '人物', to: '/personas', icon: 'i-lucide-users' },
  { label: '世界设定', to: '/worlds', icon: 'i-lucide-globe-2' },
  { label: '资料', to: '/sources', icon: 'i-lucide-library' },
  { label: '格式模板', to: '/templates', icon: 'i-lucide-layout-template' },
  { label: '参数方案', to: '/parameter-profiles', icon: 'i-lucide-sliders-horizontal' },
]

const logoutLoading = shallowRef(false)
const logoutError = shallowRef<string | null>(null)

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
  <div class="min-h-screen bg-default lg:grid lg:grid-cols-[15rem_1fr]">
    <aside class="border-b border-default bg-elevated/40 lg:min-h-screen lg:border-b-0 lg:border-r">
      <div class="flex h-16 items-center justify-between px-5 lg:block lg:h-auto lg:px-6 lg:py-7">
        <NuxtLink to="/" class="block">
          <p class="font-semibold text-highlighted">
            人样
          </p>
          <p class="text-xs text-muted">
            人物模拟与创作工作台
          </p>
        </NuxtLink>
        <UColorModeButton class="lg:hidden" aria-label="切换颜色模式" />
      </div>

      <nav class="flex gap-1 overflow-x-auto px-3 pb-3 lg:block lg:space-y-1 lg:px-3" aria-label="主导航">
        <UButton
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          :icon="item.icon"
          color="neutral"
          variant="ghost"
          class="shrink-0 justify-start"
        >
          {{ item.label }}
        </UButton>
      </nav>
    </aside>

    <div class="min-w-0">
      <header class="flex h-16 items-center justify-end gap-2 border-b border-default px-4 sm:px-6">
        <span v-if="logoutError" class="mr-auto text-sm text-error" role="alert">{{ logoutError }}</span>
        <UColorModeButton class="hidden lg:inline-flex" aria-label="切换颜色模式" />
        <UButton color="neutral" variant="ghost" :loading="logoutLoading" @click="logout">
          退出
        </UButton>
      </header>
      <main class="px-4 py-7 sm:px-6 lg:px-8">
        <slot />
      </main>
    </div>
  </div>
</template>
