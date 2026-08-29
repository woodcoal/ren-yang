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
    <ContentPageHeader title="在可追溯的记录中继续工作" description="按人物、任务类型和当前状态查找历史任务，并继续处理尚未完成的确认或失败恢复。">
      <UButton to="/workbench" icon="i-lucide-plus">创建新任务</UButton>
    </ContentPageHeader>

    <section class="content-section" aria-labelledby="history-filter-heading">
      <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">缩小范围</p><h2 id="history-filter-heading">定位需要继续处理的任务</h2><p>筛选条件会写入地址，刷新页面后仍会保留。</p></div></div>
      <form class="content-toolbar" @submit.prevent="applyFilters">
        <select v-model="filters.personaId" class="native-control" aria-label="按人物筛选"><option value="">全部人物</option><option v-for="persona in personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option></select>
        <select v-model="filters.kind" class="native-control" aria-label="按类型筛选"><option value="">全部类型</option><option value="interest_assessment">兴趣判断</option><option value="artifact_generation">图文创作</option></select>
        <select v-model="filters.status" class="native-control" aria-label="按状态筛选"><option value="">全部状态</option><option v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</option></select>
        <UButton type="submit" color="neutral" variant="soft">应用筛选</UButton>
      </form>
    </section>

    <UAlert v-if="error" color="error" title="任务记录加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <section v-else-if="runs.length" class="content-section" aria-labelledby="history-list-heading">
      <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">任务列表</p><h2 id="history-list-heading">按当前状态阅读</h2><p>每条记录保留创建时锁定的人物版本、资料、设置和模型信息。</p></div><span class="text-sm text-muted">{{ runs.length }} 条记录</span></div>
      <div class="content-table-wrap">
        <table class="content-table">
          <thead><tr><th>任务</th><th>人物</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="run in runs" :key="run.id">
              <td data-label="任务"><strong class="content-table-title">{{ run.kind === 'interest_assessment' ? '兴趣判断' : '图文创作' }}</strong><span class="content-table-description">{{ inputPreview(run) }}</span></td>
              <td data-label="人物"><span class="content-table-title">{{ run.personaName }}</span><span class="content-table-description">{{ run.model.model }}</span></td>
              <td data-label="状态"><UBadge :color="run.status === 'failed' ? 'error' : run.status === 'succeeded' ? 'success' : 'neutral'" variant="subtle">{{ statusLabels[run.status] }}</UBadge></td>
              <td data-label="创建时间"><span>{{ formatTime(run.createdAt) }}</span><span class="content-table-description">{{ run.id }}</span></td>
              <td data-label="操作"><UButton :to="`/runs/${run.id}`" color="neutral" variant="link">查看任务</UButton></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-else class="content-empty-state"><div><strong>没有符合条件的任务</strong><p>调整筛选条件，或创建一项新任务。</p></div></div>
  </div>
</template>
