<script setup lang="ts">
import { computed } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary, SourceSummary, WorldSummary } from '#shared/types/content'
import type { SystemHealthResult } from '#shared/types/system'
import SystemStatusPanel from '../components/system/SystemStatusPanel.vue'

const [{ data: healthData, error, refresh }, { data: personaData }, { data: worldData }, { data: sourceData }] = await Promise.all([
  useFetch<ApiResponse<SystemHealthResult>>('/api/v1/system/health'),
  useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas'),
  useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds'),
  useFetch<ApiResponse<SourceSummary[]>>('/api/v1/sources'),
])
const health = computed(() => healthData.value?.data ?? null)
const counts = computed(() => ({
  personas: personaData.value?.data.length ?? 0,
  worlds: worldData.value?.data.length ?? 0,
  sources: sourceData.value?.data.length ?? 0,
}))
</script>

<template>
  <div>
    <ContentPageHeader
      title="仪表盘"
      description="本地人物事实源、版本和资料索引概览。"
    />

    <div class="mb-7 grid gap-4 sm:grid-cols-3">
      <UCard v-for="item in [
        { label: '人物', value: counts.personas, to: '/personas' },
        { label: '世界设定', value: counts.worlds, to: '/worlds' },
        { label: '资料', value: counts.sources, to: '/sources' },
      ]" :key="item.label">
        <p class="text-sm text-muted">{{ item.label }}</p>
        <p class="mt-2 text-3xl font-semibold text-highlighted">{{ item.value }}</p>
        <UButton :to="item.to" color="neutral" variant="link" class="mt-2 px-0">进入管理</UButton>
      </UCard>
    </div>

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
  </div>
</template>
