<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary, WorldSummary } from '#shared/types/content'
import type { AnalysisBatchView, AnalysisType } from '#shared/types/analysis'
import type { RunSummary } from '#shared/types/generation'

type HistoryStatus = RunSummary['status'] | AnalysisBatchView['status']
type HistoryKind = RunSummary['kind'] | AnalysisType

/** 任务记录页统一展示的一项生成运行或后台提炼。 */
interface HistoryItem {
  id: string
  kind: HistoryKind
  kindLabel: string
  subjectType: 'persona' | 'world'
  subjectId: string
  subjectName: string
  status: HistoryStatus
  description: string
  secondary: string
  createdAt: number
  detailsPath: string
  detailsLabel: string
  /** 当前任务对象存在时可进入的人物或世界详情地址。 */
  subjectPath: string | null
}

const route = useRoute()
const filters = reactive({
  personaId: typeof route.query.personaId === 'string' ? route.query.personaId : '',
  kind: typeof route.query.kind === 'string' ? route.query.kind : '',
  status: typeof route.query.status === 'string' ? route.query.status : '',
})
const [
  { data: runData, error: runError, refresh: refreshRuns },
  { data: analysisData, error: analysisError, refresh: refreshAnalysis },
  { data: personaData, error: personaError, refresh: refreshPersonas },
  { data: worldData, error: worldError, refresh: refreshWorlds },
] = await Promise.all([
  useFetch<ApiResponse<RunSummary[]>>('/api/v1/runs?limit=100'),
  useFetch<ApiResponse<AnalysisBatchView[]>>('/api/v1/analysis-batches?limit=100'),
  useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas'),
  useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds'),
])
const personas = computed(() => personaData.value?.data ?? [])
const worlds = computed(() => worldData.value?.data ?? [])
const error = computed(() => runError.value ?? analysisError.value ?? personaError.value ?? worldError.value)

/** 运行状态中文标签。 */
const statusLabels: Record<HistoryStatus, string> = {
  planning: '规划中', awaiting_confirmation: '等待确认', queued: '排队中', running: '执行中',
  succeeded: '成功', partial: '部分成功', failed: '失败', canceled: '已取消',
  awaiting_review: '等待审核', completed: '已完成',
}

/** 任务类型中文标签。 */
const kindLabels: Record<HistoryKind, string> = {
  interest_assessment: '兴趣判断', artifact_generation: '图文创作',
  world_growth: '世界成长提炼', persona_growth: '人物成长提炼', persona_memory: '人物记忆提炼',
}

/** 合并生成运行与后台提炼，并按页面筛选条件和创建时间排序。 */
const items = computed<HistoryItem[]>(() => {
  const personaNames = new Map(personas.value.map(persona => [persona.id, persona.name]))
  const worldNames = new Map(worlds.value.map(world => [world.id, world.name]))
  const runs: HistoryItem[] = (runData.value?.data ?? []).map(run => ({
    id: run.id,
    kind: run.kind,
    kindLabel: kindLabels[run.kind],
    subjectType: 'persona',
    subjectId: run.personaId,
    subjectName: run.personaName,
    status: run.status,
    description: inputPreview(run),
    secondary: run.model.model,
    createdAt: run.createdAt,
    detailsPath: `/runs/${run.id}`,
    detailsLabel: '查看任务',
    subjectPath: personaNames.has(run.personaId) ? `/personas/${run.personaId}` : null,
  }))
  const analyses: HistoryItem[] = (analysisData.value?.data ?? []).map(batch => ({
    id: batch.id,
    kind: batch.analysisType,
    kindLabel: kindLabels[batch.analysisType],
    subjectType: batch.analysisType === 'world_growth' ? 'world' : 'persona',
    subjectId: batch.subjectId,
    subjectName: batch.analysisType === 'world_growth'
      ? worldNames.get(batch.subjectId) ?? '已删除世界'
      : personaNames.get(batch.subjectId) ?? '已删除人物',
    status: batch.status,
    description: batch.resultSummary ?? batch.errorMessage ?? `${batch.inputs.length} 项原始素材`,
    secondary: batch.mode === 'incremental' ? '结合新增素材' : '全部素材重建',
    createdAt: batch.createdAt,
    detailsPath: batch.analysisType === 'world_growth' ? `/worlds/${batch.subjectId}` : `/personas/${batch.subjectId}`,
    detailsLabel: '查看对象',
    subjectPath: batch.analysisType === 'world_growth'
      ? worldNames.has(batch.subjectId) ? `/worlds/${batch.subjectId}` : null
      : personaNames.has(batch.subjectId) ? `/personas/${batch.subjectId}` : null,
  }))
  return [...runs, ...analyses]
    .filter(item => !filters.personaId || (item.subjectType === 'persona' && item.subjectId === filters.personaId))
    .filter(item => !filters.kind || item.kind === filters.kind)
    .filter(item => !filters.status || item.status === filters.status)
    .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
})

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

/** @param status 统一任务状态。 @returns Nuxt UI 徽标颜色。 */
function statusColor(status: HistoryStatus): 'error' | 'success' | 'warning' | 'neutral' {
  if (status === 'failed') return 'error'
  if (status === 'succeeded' || status === 'completed') return 'success'
  if (status === 'awaiting_confirmation' || status === 'awaiting_review' || status === 'partial') return 'warning'
  return 'neutral'
}

/** @returns 重新读取生成运行、后台提炼和对象名称。 */
async function refreshAll(): Promise<void> {
  await Promise.all([refreshRuns(), refreshAnalysis(), refreshPersonas(), refreshWorlds()])
}

/** @param timestamp UTC Unix 毫秒。 @returns 本地日期时间。 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <ContentPageHeader title="在可追溯的记录中继续工作" description="统一查看生成任务、后台成长提炼和记忆提炼，并按对象、类型和状态定位记录。">
      <UButton to="/workbench" icon="i-lucide-plus">创建新任务</UButton>
    </ContentPageHeader>

    <section class="content-section" aria-labelledby="history-filter-heading">
      <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">缩小范围</p><h2 id="history-filter-heading">定位需要继续处理的任务</h2><p>筛选条件会写入地址，刷新页面后仍会保留。</p></div></div>
      <form class="content-toolbar" @submit.prevent="applyFilters">
        <select v-model="filters.personaId" class="native-control" aria-label="按人物筛选"><option value="">全部人物</option><option v-for="persona in personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option></select>
        <select v-model="filters.kind" class="native-control" aria-label="按类型筛选"><option value="">全部类型</option><option value="interest_assessment">兴趣判断</option><option value="artifact_generation">图文创作</option><option value="world_growth">世界成长提炼</option><option value="persona_growth">人物成长提炼</option><option value="persona_memory">人物记忆提炼</option></select>
        <select v-model="filters.status" class="native-control" aria-label="按状态筛选"><option value="">全部状态</option><option v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</option></select>
        <UButton type="submit" color="neutral" variant="soft">应用筛选</UButton>
      </form>
    </section>

    <UAlert v-if="error" color="error" title="任务记录加载失败" :actions="[{ label: '重试', onClick: refreshAll }]" />
    <section v-else-if="items.length" class="content-section" aria-labelledby="history-list-heading">
      <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">任务列表</p><h2 id="history-list-heading">按当前状态阅读</h2><p>生成运行保留模型与输入；后台提炼保留对象、素材快照、状态和失败原因。</p></div><span class="text-sm text-muted">{{ items.length }} 条记录</span></div>
      <div class="content-table-wrap">
        <table class="content-table">
          <thead><tr><th>任务</th><th>对象</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="item in items" :key="`${item.kind}:${item.id}`">
              <td data-label="任务"><NuxtLink :to="item.detailsPath" class="content-table-title hover:underline"><strong>{{ item.kindLabel }}</strong></NuxtLink><span class="content-table-description">{{ item.description }}</span></td>
              <td data-label="对象"><NuxtLink v-if="item.subjectPath" :to="item.subjectPath" class="content-table-title hover:underline">{{ item.subjectName }}</NuxtLink><span v-else class="content-table-title">{{ item.subjectName }}</span><span class="content-table-description">{{ item.secondary }}</span></td>
              <td data-label="状态"><UBadge :color="statusColor(item.status)" variant="subtle">{{ statusLabels[item.status] }}</UBadge></td>
              <td data-label="创建时间"><span>{{ formatTime(item.createdAt) }}</span><span class="content-table-description">{{ item.id }}</span></td>
              <td data-label="操作"><UButton :to="item.detailsPath" color="neutral" variant="link">{{ item.detailsLabel }}</UButton></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-else class="content-empty-state"><div><strong>没有符合条件的任务</strong><p>调整筛选条件，或创建一项新任务。</p></div></div>
  </div>
</template>
