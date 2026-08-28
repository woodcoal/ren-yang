<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { SystemHealthResult } from '#shared/types/system'
import SystemStatusPanel from '../components/system/SystemStatusPanel.vue'
import { getApiErrorMessage } from '../utils/apiError'

const logoutLoading = shallowRef(false)
const logoutError = shallowRef<string | null>(null)

const { data, error, refresh } = await useFetch<ApiResponse<SystemHealthResult>>('/api/v1/system/health')
const health = computed(() => data.value?.data ?? null)

/**
 * 清除会话并返回登录页。
 * @returns 请求和导航完成时结束。
 */
async function logout(): Promise<void> {
  logoutLoading.value = true
  logoutError.value = null
  try {
    await $fetch('/api/v1/auth/logout', { method: 'POST' })
    await navigateTo('/login')
  }
  catch (requestError: unknown) {
    logoutError.value = getApiErrorMessage(requestError, '退出失败，请重试')
  }
  finally {
    logoutLoading.value = false
  }
}
</script>

<template>
  <main class="min-h-screen bg-default">
    <header class="border-b border-default">
      <UContainer class="flex h-16 items-center justify-between gap-4">
        <div>
          <h1 class="font-semibold text-highlighted">
            人样
          </h1>
          <p class="text-xs text-muted">
            创作工作台
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UColorModeButton aria-label="切换颜色模式" />
          <UButton
            color="neutral"
            variant="ghost"
            :loading="logoutLoading"
            @click="logout"
          >
            退出
          </UButton>
        </div>
      </UContainer>
    </header>

    <UContainer class="py-8">
      <div class="mb-6">
        <h2 class="text-2xl font-semibold text-highlighted">
          工程基线
        </h2>
        <p class="mt-1 text-sm text-muted">
          阶段一仅提供登录、SQLite 和内部 Worker；人物业务将在下一阶段实现。
        </p>
      </div>

      <UAlert
        v-if="logoutError"
        class="mb-6"
        color="error"
        title="退出失败"
        :description="logoutError"
      />

      <SystemStatusPanel
        v-if="health"
        :health="health"
      />

      <UAlert
        v-else
        color="error"
        title="无法读取系统状态"
        :description="error ? '健康检查请求失败' : '健康检查没有返回数据'"
        :actions="[{ label: '重试', onClick: () => refresh() }]"
      />
    </UContainer>
  </main>
</template>
