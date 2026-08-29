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
      title="今日工作"
      description="待处理事项、活动任务和会影响工作的系统问题按优先级排列。"
    >
      <UButton to="/history" color="neutral" variant="outline">查看任务记录</UButton>
      <UButton to="/workbench" icon="i-lucide-plus">新建任务</UButton>
    </ContentPageHeader>

    <UAlert
      v-if="summaryError"
      class="mb-5"
      color="error"
      title="部分仪表盘数据加载失败"
      description="资源、活动运行或待处理反馈数量可能不完整。"
      :actions="[{ label: '全部重试', onClick: refreshDashboard }]"
    />

    <div class="metric-strip" aria-label="工作台资源摘要">
      <div v-for="item in [
        { label: '人物', value: counts.personas, to: '/personas' },
        { label: '世界设定', value: counts.worlds, to: '/worlds' },
        { label: '资料库', value: counts.sources, to: '/sources' },
        { label: '后台任务', value: health?.taskQueue.total ?? 0, to: '/history' },
      ]" :key="item.label" class="metric-cell">
        <span class="metric-value">{{ item.value }}</span>
        <span class="metric-label">{{ item.label }}</span>
        <NuxtLink :to="item.to" class="metric-link">进入管理</NuxtLink>
      </div>
    </div>

    <SystemDashboardWorkPanel
      :personas="personas"
      :runs="runs"
      :pending-feedback-count="pendingFeedbackCount"
      :pending-proposal-count="pendingProposalCount"
    />

    <section class="content-section" aria-labelledby="dashboard-system-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">04 · 系统影响</p>
          <h2 id="dashboard-system-heading">只在这里展开技术状态</h2>
          <p>SQLite、后台任务和模型能力不会挤占日常工作区域。</p>
        </div>
      </div>

      <details class="system-details">
        <summary>查看完整系统状态</summary>
        <div class="system-details-content">
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
      </details>
    </section>
  </div>
</template>
