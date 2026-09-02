<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary } from '#shared/types/content'
import type { HistoryKind, HistoryStatus } from '#shared/schemas/history'
import type { HistoryItemView, HistoryPageView } from '#shared/types/history'

const route = useRoute()

/** 任务记录页允许的任务类型。 */
const historyKinds: readonly HistoryKind[] = [
  'persona_distillation', 'interest_assessment', 'artifact_generation', 'world_growth', 'persona_growth', 'persona_memory',
]

/** 任务记录页允许的统一状态。 */
const historyStatuses: readonly HistoryStatus[] = [
  'planning', 'awaiting_confirmation', 'queued', 'running', 'succeeded', 'partial', 'failed', 'canceled',
  'cancel_requested', 'awaiting_review', 'completed',
]

/** @param value 查询参数原值。 @param fallback 无效时的默认值。 @returns 正整数。 */
function readPositiveInteger(value: unknown, fallback: number): number {
  const normalized = Array.isArray(value) ? value[0] : value
  const parsed = Number(normalized)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** @param value 查询参数原值。 @returns 支持的每页数量，无效值回退为 10。 */
function readPageSize(value: unknown): 5 | 10 | 20 | 50 | 100 {
  const parsed = readPositiveInteger(value, 10)
  return parsed === 5 || parsed === 20 || parsed === 50 || parsed === 100 ? parsed : 10
}

/** @param value 查询参数原值。 @returns 单个非空字符串，不符合时返回 undefined。 */
function readTextQuery(value: unknown): string | undefined {
  const normalized = Array.isArray(value) ? value[0] : value
  return typeof normalized === 'string' && normalized.trim() ? normalized.trim() : undefined
}

/** @param value 查询参数原值。 @returns 有效任务类型，不符合时返回 undefined。 */
function readHistoryKind(value: unknown): HistoryKind | undefined {
  const normalized = readTextQuery(value)
  return historyKinds.includes(normalized as HistoryKind) ? normalized as HistoryKind : undefined
}

/** @param value 查询参数原值。 @returns 有效任务状态，不符合时返回 undefined。 */
function readHistoryStatus(value: unknown): HistoryStatus | undefined {
  const normalized = readTextQuery(value)
  return historyStatuses.includes(normalized as HistoryStatus) ? normalized as HistoryStatus : undefined
}

const requestedPage = computed(() => readPositiveInteger(route.query.page, 1))
const requestedPageSize = computed(() => readPageSize(route.query.pageSize))
const requestedPersonaId = computed(() => readTextQuery(route.query.personaId))
const requestedKind = computed(() => readHistoryKind(route.query.kind))
const requestedStatus = computed(() => readHistoryStatus(route.query.status))
const filters = reactive({
  personaId: requestedPersonaId.value ?? '',
  kind: requestedKind.value ?? '',
  status: requestedStatus.value ?? '',
})
const historyQuery = computed(() => ({
  page: requestedPage.value,
  pageSize: requestedPageSize.value,
  personaId: requestedPersonaId.value,
  kind: requestedKind.value,
  status: requestedStatus.value,
}))
const [
  { data: historyData, error: historyError, refresh: refreshHistory },
  { data: personaData, error: personaError, refresh: refreshPersonas },
] = await Promise.all([
  useFetch<ApiResponse<HistoryPageView>>('/api/v1/history', { query: historyQuery }),
  useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas'),
])
const personas = computed(() => personaData.value?.data ?? [])
const historyPage = computed<HistoryPageView>(() => historyData.value?.data ?? {
  items: [], total: 0, page: requestedPage.value, pageSize: requestedPageSize.value, totalPages: 1,
})
const items = computed(() => historyPage.value.items)
const error = computed(() => historyError.value ?? personaError.value)

/** 运行状态中文标签。 */
const statusLabels: Record<HistoryStatus, string> = {
  planning: '规划中', awaiting_confirmation: '等待确认', queued: '排队中', running: '执行中',
  succeeded: '成功', partial: '部分成功', failed: '失败', canceled: '已取消',
  cancel_requested: '取消中', awaiting_review: '等待审核', completed: '已完成',
}

/** 任务类型中文标签。 */
const kindLabels: Record<HistoryKind, string> = {
  persona_distillation: '人物蒸馏', interest_assessment: '兴趣判断', artifact_generation: '图文创作',
  world_growth: '世界成长提炼', persona_growth: '人物成长提炼', persona_memory: '人物记忆提炼',
}

/** 可选择的每页任务数量。 */
const pageSizeItems = [
  { label: '每页 5 条', value: 5 }, { label: '每页 10 条', value: 10 }, { label: '每页 20 条', value: 20 },
  { label: '每页 50 条', value: 50 }, { label: '每页 100 条', value: 100 },
]

/** @returns 浏览器前进或后退后，把 URL 筛选条件同步回表单。 */
function synchronizeFilters(): void {
  filters.personaId = requestedPersonaId.value ?? ''
  filters.kind = requestedKind.value ?? ''
  filters.status = requestedStatus.value ?? ''
}

watch([requestedPersonaId, requestedKind, requestedStatus], synchronizeFilters)

/** @returns 把当前筛选写入 URL，确保刷新页面后可恢复。 */
async function applyFilters(): Promise<void> {
  await navigateTo({
    path: '/history',
    query: {
      ...(filters.personaId ? { personaId: filters.personaId } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      page: '1',
      pageSize: String(historyPage.value.pageSize),
    },
  })
}

/** @param value 任务说明原文。 @returns 最多 120 字的列表预览。 */
function descriptionPreview(value: string): string {
  return value.length > 120 ? `${value.slice(0, 120)}…` : value
}

/** @param item 统一任务记录。 @returns 任务详情或所属对象详情地址。 */
function detailsPath(item: HistoryItemView): string {
  if (item.sourceType === 'distillation') return `/personas/distillations/${item.id}`
  if (item.sourceType === 'interest_batch') return `/interest-batches/${item.id}`
  if (item.sourceType === 'run') return `/runs/${item.id}`
  return item.subjectType === 'world' ? `/worlds/${item.subjectId}` : `/personas/${item.subjectId}`
}

/** @param item 统一任务记录。 @returns 当前对象存在时的详情地址，否则返回 null。 */
function subjectPath(item: HistoryItemView): string | null {
  if (!item.subjectExists) return null
  return item.subjectType === 'world' ? `/worlds/${item.subjectId}` : `/personas/${item.subjectId}`
}

/** @param status 统一任务状态。 @returns Nuxt UI 徽标颜色。 */
function statusColor(status: HistoryStatus): 'error' | 'success' | 'warning' | 'neutral' {
  if (status === 'failed') return 'error'
  if (status === 'succeeded' || status === 'completed') return 'success'
  if (status === 'awaiting_confirmation' || status === 'awaiting_review' || status === 'partial') return 'warning'
  return 'neutral'
}

/** @param item 失败的统一任务记录。 @returns 可直接展示的错误码和失败原因，缺失时返回明确兜底说明。 */
function failureDescription(item: HistoryItemView): string {
  return [item.errorCode, item.errorMessage].filter(Boolean).join('：') || '未记录失败原因'
}

/** @returns 重新读取生成运行、后台提炼和对象名称。 */
async function refreshAll(): Promise<void> {
  await Promise.all([refreshHistory(), refreshPersonas()])
}

/** @param page 新页码。 @param pageSize 新每页数量。 @returns 路由导航完成时结束。 */
async function updatePagination(page: number, pageSize: 5 | 10 | 20 | 50 | 100): Promise<void> {
  await navigateTo({ path: route.path, query: { ...route.query, page: String(page), pageSize: String(pageSize) } })
}

/** @param page 新页码。 @returns 路由导航完成时结束。 */
async function changePage(page: number): Promise<void> {
  await updatePagination(page, historyPage.value.pageSize)
}

/** @param pageSize 新每页数量。 @returns 回到第一页的路由导航完成时结束。 */
async function changePageSize(pageSize: number): Promise<void> {
  await updatePagination(1, readPageSize(pageSize))
}

/** @param timestamp UTC Unix 毫秒。 @returns 本地日期时间。 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <ContentPageHeader title="在可追溯的记录中继续工作" description="统一查看人物创建、生成任务、后台成长提炼和记忆提炼，并按对象、类型和状态定位记录。">
      <UButton to="/workbench" icon="i-lucide-plus">创建新任务</UButton>
    </ContentPageHeader>

    <UAlert v-if="error" color="error" title="任务记录加载失败" :actions="[{ label: '重试', onClick: refreshAll }]" />
    <section v-else class="content-section" aria-labelledby="history-list-heading">
      <h2 id="history-list-heading" class="visually-hidden">任务记录列表</h2>
      <div class="list-management-panel">
        <div class="list-management-controls">
          <form class="list-management-search col-span-full" aria-label="筛选任务记录" @submit.prevent="applyFilters">
            <select v-model="filters.personaId" class="native-control min-w-0 flex-1" aria-label="按人物筛选">
              <option value="">全部人物</option>
              <option v-for="persona in personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option>
            </select>
            <select v-model="filters.kind" class="native-control min-w-0 flex-1" aria-label="按类型筛选">
              <option value="">全部类型</option>
              <option value="persona_distillation">人物蒸馏</option>
              <option value="interest_assessment">兴趣判断</option>
              <option value="artifact_generation">图文创作</option>
              <option value="world_growth">世界成长提炼</option>
              <option value="persona_growth">人物成长提炼</option>
              <option value="persona_memory">人物记忆提炼</option>
            </select>
            <select v-model="filters.status" class="native-control min-w-0 flex-1" aria-label="按状态筛选">
              <option value="">全部状态</option>
              <option v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</option>
            </select>
            <UButton type="submit" color="neutral" variant="soft">应用筛选</UButton>
          </form>
        </div>

        <template v-if="items.length">
          <div class="content-table-wrap list-management-table">
            <table class="content-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>对象</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in items" :key="`${item.sourceType}:${item.id}`">
                  <td data-label="任务">
                    <NuxtLink :to="detailsPath(item)" class="content-table-title hover:underline"><strong>{{
                      kindLabels[item.kind] }}</strong></NuxtLink><span class="content-table-description">{{
                      descriptionPreview(item.description) }}</span>
                  </td>
                  <td data-label="对象">
                    <NuxtLink v-if="subjectPath(item)" :to="subjectPath(item)!"
                      class="content-table-title hover:underline">{{ item.subjectName }}</NuxtLink><span v-else
                      class="content-table-title">{{ item.subjectName }}</span><span
                      class="content-table-description">{{ item.secondary }}</span>
                  </td>
                  <td data-label="状态">
                    <UBadge :color="statusColor(item.status)" variant="subtle">{{ statusLabels[item.status] }}</UBadge>
                    <span v-if="item.errorCode || item.errorMessage || item.status === 'failed'"
                      class="content-table-description text-error">{{
                      failureDescription(item) }}</span>
                  </td>
                  <td data-label="创建时间"><span>{{ formatTime(item.createdAt) }}</span><span
                      class="content-table-description">{{ item.id }}</span></td>
                  <td data-label="操作">
                    <UButton :to="detailsPath(item)" color="neutral" variant="ghost" size="xs"
                      icon="i-lucide-chevron-right" :aria-label="`查看任务：${kindLabels[item.kind]}`" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="list-management-footer">
            <p class="m-0 text-sm text-muted">第 {{ historyPage.page }} / {{ historyPage.totalPages }} 页，共 {{
              historyPage.total }} 项</p>
            <div class="list-management-pagination">
              <USelect :model-value="historyPage.pageSize" class="w-34" :items="pageSizeItems" aria-label="每页任务数量"
                @update:model-value="changePageSize" />
              <UPagination :page="historyPage.page" :total="historyPage.total" :items-per-page="historyPage.pageSize"
                show-edges @update:page="changePage" />
            </div>
          </div>
        </template>
        <div v-else class="content-empty-state list-management-empty">
          <div><strong>没有符合条件的任务</strong>
            <p>调整筛选条件，或创建一项新任务。</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
