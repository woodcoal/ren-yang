<script setup lang="ts">
import { computed } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary, SourceSummary, WorldSummary } from '#shared/types/content'
import type { FeedbackView, RevisionProposalView } from '#shared/types/feedback'
import type { RunSummary } from '#shared/types/generation'
import type { SystemCapabilitiesResult, SystemHealthResult } from '#shared/types/system'
import SystemStatusPanel from '../components/system/SystemStatusPanel.vue'

const [
  { data: healthData, error: healthError, refresh: refreshHealth },
  { data: personaData, error: personaError, refresh: refreshPersonas },
  { data: worldData, error: worldError, refresh: refreshWorlds },
  { data: sourceData, error: sourceError, refresh: refreshSources },
  { data: runData, error: runError, refresh: refreshRuns },
  { data: feedbackData, error: feedbackError, refresh: refreshFeedback },
  { data: proposalData, error: proposalError, refresh: refreshProposals },
  { data: capabilityData, error: capabilityError, refresh: refreshCapabilities },
] = await Promise.all([
  useFetch<ApiResponse<SystemHealthResult>>('/api/v1/system/health'),
  useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas'),
  useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds'),
  useFetch<ApiResponse<SourceSummary[]>>('/api/v1/sources'),
  useFetch<ApiResponse<RunSummary[]>>('/api/v1/runs?limit=100'),
  useFetch<ApiResponse<FeedbackView[]>>('/api/v1/feedback'),
  useFetch<ApiResponse<RevisionProposalView[]>>('/api/v1/revision-proposals'),
  useFetch<ApiResponse<SystemCapabilitiesResult>>('/api/v1/system/capabilities'),
])
const health = computed(() => healthData.value?.data ?? null)
const capabilities = computed(() => capabilityData.value?.data ?? null)
const personas = computed(() => personaData.value?.data ?? [])
const runs = computed(() => runData.value?.data ?? [])
const pendingFeedbackCount = computed(() => (feedbackData.value?.data ?? []).filter(item => item.confirmedTarget === null).length)
const pendingProposalCount = computed(() => (proposalData.value?.data ?? []).filter(item => !['published', 'rejected'].includes(item.status)).length)
const counts = computed(() => ({
  personas: personas.value.length,
  worlds: worldData.value?.data.length ?? 0,
  sources: sourceData.value?.data.length ?? 0,
}))
const summaryError = computed(() => personaError.value || worldError.value || sourceError.value || runError.value || feedbackError.value || proposalError.value)

/** @returns 并行刷新仪表盘全部只读数据。 */
async function refreshDashboard(): Promise<void> {
  await Promise.all([
    refreshHealth(), refreshPersonas(), refreshWorlds(), refreshSources(), refreshRuns(),
    refreshFeedback(), refreshProposals(), refreshCapabilities(),
  ])
}
</script>

<template>
  <div>
    <ContentPageHeader
      title="仪表盘"
      description="本地人物事实源、版本和资料索引概览。"
    />

    <UAlert
      v-if="summaryError"
      class="mb-5"
      color="error"
      title="部分仪表盘数据加载失败"
      description="资源、活动运行或待处理反馈数量可能不完整。"
      :actions="[{ label: '全部重试', onClick: refreshDashboard }]"
    />

    <div class="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <UCard v-for="item in [
        { label: '人物', value: counts.personas, to: '/personas' },
        { label: '世界设定', value: counts.worlds, to: '/worlds' },
        { label: '资料', value: counts.sources, to: '/sources' },
        { label: '后台任务', value: health?.taskQueue.total ?? 0, to: '/history' },
      ]" :key="item.label">
        <p class="text-sm text-muted">{{ item.label }}</p>
        <p class="mt-2 text-3xl font-semibold text-highlighted">{{ item.value }}</p>
        <UButton :to="item.to" color="neutral" variant="link" class="mt-2 px-0">进入管理</UButton>
      </UCard>
    </div>

    <SystemDashboardWorkPanel
      class="mb-6"
      :personas="personas"
      :runs="runs"
      :pending-feedback-count="pendingFeedbackCount"
      :pending-proposal-count="pendingProposalCount"
    />

    <div class="grid gap-6 xl:grid-cols-2">
      <SystemStatusPanel
        v-if="health"
        :health="health"
      />

      <UAlert
        v-else
        color="error"
        title="无法读取系统状态"
        :description="healthError ? '健康检查请求失败' : '健康检查没有返回数据'"
        :actions="[{ label: '重试', onClick: () => refreshHealth() }]"
      />

      <SystemCapabilityStatusPanel v-if="capabilities" :capabilities="capabilities" />
      <UAlert
        v-else
        color="error"
        title="无法读取外部能力状态"
        :description="capabilityError ? '能力状态请求失败' : '能力状态没有返回数据'"
        :actions="[{ label: '重试', onClick: () => refreshCapabilities() }]"
      />
    </div>
  </div>
</template>
