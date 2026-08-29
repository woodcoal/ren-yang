<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary } from '#shared/types/content'
import type { RunSummary } from '#shared/types/generation'

const route = useRoute()
const filters = reactive({
  personaId: typeof route.query.personaId === 'string' ? route.query.personaId : '',
  kind: typeof route.query.kind === 'string' ? route.query.kind : '',
  status: typeof route.query.status === 'string' ? route.query.status : '',
})
const requestUrl = computed(() => {
  const query = new URLSearchParams({ limit: '100' })
  if (filters.personaId) query.set('personaId', filters.personaId)
  if (filters.kind) query.set('kind', filters.kind)
  if (filters.status) query.set('status', filters.status)
  return `/api/v1/runs?${query.toString()}`
})
const [{ data, error, refresh }, { data: personaData }] = await Promise.all([
  useFetch<ApiResponse<RunSummary[]>>(requestUrl),
  useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas'),
])
const runs = computed(() => data.value?.data ?? [])
const personas = computed(() => personaData.value?.data ?? [])

/** 运行状态中文标签。 */
const statusLabels: Record<RunSummary['status'], string> = {
  planning: '规划中', awaiting_confirmation: '等待确认', queued: '排队中', running: '执行中',
  succeeded: '成功', partial: '部分成功', failed: '失败', canceled: '已取消',
}

/** @returns 把当前筛选写入 URL，确保刷新页面后可恢复。 */
async function applyFilters(): Promise<void> {
  await navigateTo({
    path: '/history',
    query: {
      ...(filters.personaId ? { personaId: filters.personaId } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
  })
}

/** @param run 运行摘要。 @returns 输入内容的简短预览。 */
function inputPreview(run: RunSummary): string {
  const value = 'content' in run.input ? run.input.content : run.input.requirement
  return value.length > 120 ? `${value.slice(0, 120)}…` : value
}

/** @param timestamp UTC Unix 毫秒。 @returns 本地日期时间。 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <ContentPageHeader title="任务记录" description="查看每次判断或创作使用了哪个人物、哪些资料、哪些设置，以及最终结果。">
      <UButton to="/workbench" icon="i-lucide-plus">创建新任务</UButton>
    </ContentPageHeader>

    <UCard class="mb-6">
      <form class="grid gap-3 md:grid-cols-4" @submit.prevent="applyFilters">
        <select v-model="filters.personaId" class="native-control" aria-label="按人物筛选"><option value="">全部人物</option><option v-for="persona in personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option></select>
        <select v-model="filters.kind" class="native-control" aria-label="按类型筛选"><option value="">全部类型</option><option value="interest_assessment">兴趣判断</option><option value="artifact_generation">图文创作</option></select>
        <select v-model="filters.status" class="native-control" aria-label="按状态筛选"><option value="">全部状态</option><option v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</option></select>
        <UButton type="submit" color="neutral" variant="soft">应用筛选</UButton>
      </form>
    </UCard>

    <UAlert v-if="error" color="error" title="任务记录加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <div v-else-if="runs.length" class="space-y-3">
      <NuxtLink v-for="run in runs" :key="run.id" :to="`/runs/${run.id}`" class="block rounded-md border border-default p-4 transition hover:bg-elevated">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="font-medium text-highlighted">{{ run.personaName }} · {{ run.kind === 'interest_assessment' ? '兴趣判断' : '图文创作' }}</h2>
            <p class="mt-1 text-sm text-muted">{{ inputPreview(run) }}</p>
          </div>
          <UBadge :color="run.status === 'failed' ? 'error' : run.status === 'succeeded' ? 'success' : 'neutral'" variant="subtle">{{ statusLabels[run.status] }}</UBadge>
        </div>
        <p class="mt-3 text-xs text-dimmed">{{ formatTime(run.createdAt) }} · {{ run.model.model }} · {{ run.id }}</p>
      </NuxtLink>
    </div>
    <UCard v-else><p class="py-8 text-center text-sm text-muted">当前筛选条件下没有任务记录。</p></UCard>
  </div>
</template>
