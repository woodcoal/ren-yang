<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { CreateSourceWithTargetsInput } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary, SourceChunkView, SourceDetails, SourcePageView, SourceStatusUpdateResult, SourceSummary, WorldSummary } from '#shared/types/content'
import type { SourceFileSubmission } from '../../components/content/SourceImportForm.vue'
import { getApiErrorMessage } from '../../utils/apiError'

const route = useRoute()

/**
 * 从 URL 查询参数读取大于零的整数。
 * @param value 路由查询参数原值。
 * @param fallback 参数缺失或无效时使用的值。
 * @returns 可安全发送到分页接口的整数。
 */
function readPositiveInteger(value: unknown, fallback: number): number {
  const normalized = Array.isArray(value) ? value[0] : value
  const parsed = Number(normalized)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * 从 URL 查询参数读取允许的每页数量。
 * @param value 路由查询参数原值。
 * @returns 5、10、20、50 或 100，非法值回退为 10。
 */
function readPageSize(value: unknown): 5 | 10 | 20 | 50 | 100 {
  const parsed = readPositiveInteger(value, 10)
  return parsed === 5 || parsed === 20 || parsed === 50 || parsed === 100 ? parsed : 10
}

const requestedPage = computed(() => readPositiveInteger(route.query.page, 1))
const requestedPageSize = computed(() => readPageSize(route.query.pageSize))
const sourcePageQuery = computed(() => ({ page: requestedPage.value, pageSize: requestedPageSize.value }))

const [
  { data, error, refresh },
  { data: personaData, error: personaError },
  { data: worldData, error: worldError },
] = await Promise.all([
  useFetch<ApiResponse<SourcePageView>>('/api/v1/sources/page', { query: sourcePageQuery }),
  useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas'),
  useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds'),
])
const sourcePage = computed<SourcePageView>(() => data.value?.data ?? {
  items: [],
  total: 0,
  page: requestedPage.value,
  pageSize: requestedPageSize.value,
  totalPages: 1,
})
const sources = computed(() => sourcePage.value.items)
const personas = computed(() => personaData.value?.data ?? [])
const worlds = computed(() => worldData.value?.data ?? [])
const chunkCount = computed(() => sources.value.reduce((total, source) => total + source.chunkCount, 0))
const linkedSourceCount = computed(() => sources.value.filter(source => source.linkCount > 0).length)
const fileSourceCount = computed(() => sources.value.filter(source => source.inputType !== 'paste').length)
const enabledSourceCount = computed(() => sources.value.filter(source => source.isEnabled).length)
const showImport = shallowRef(false)
const loading = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)
const searchQuery = shallowRef('')
const searchResults = shallowRef<SourceChunkView[] | null>(null)
const selectedSourceIds = ref<string[]>([])
const batchDisableConfirmationOpen = shallowRef(false)
const batchDisabling = shallowRef(false)
const enabledPageSourceIds = computed(() => sources.value.filter(source => source.isEnabled).map(source => source.id))
const allEnabledPageSourcesSelected = computed(() => enabledPageSourceIds.value.length > 0
  && enabledPageSourceIds.value.every(sourceId => selectedSourceIds.value.includes(sourceId)))
const someEnabledPageSourcesSelected = computed(() => selectedSourceIds.value.length > 0 && !allEnabledPageSourcesSelected.value)

/** 可选择的每页资料数量。 */
const pageSizeItems = [
  { label: '每页 5 条', value: 5 },
  { label: '每页 10 条', value: 10 },
  { label: '每页 20 条', value: 20 },
  { label: '每页 50 条', value: 50 },
  { label: '每页 100 条', value: 100 },
]

/** 资料角色中文标签。 */
const roleLabels: Record<SourceSummary['role'], string> = {
  canon_fact: '原作中的确定事实',
  reference: '背景参考',
  style_sample: '写作风格参考',
}

/**
 * 清空当前页勾选；分页变化后不保留跨页选择。
 * @returns 无返回值。
 */
function clearSourceSelection(): void {
  selectedSourceIds.value = []
}

watch([requestedPage, requestedPageSize], clearSourceSelection)

/**
 * 根据复选框状态添加或移除一项当前页资料。
 * @param sourceId 当前页资料 UUID。
 * @param event 原生复选框 change 事件。
 * @returns 无返回值。
 */
function updateSourceSelection(sourceId: string, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  selectedSourceIds.value = checked
    ? [...new Set([...selectedSourceIds.value, sourceId])]
    : selectedSourceIds.value.filter(value => value !== sourceId)
}

/**
 * 选择或取消选择当前页全部已启用资料。
 * @param event 表头复选框 change 事件。
 * @returns 无返回值。
 */
function updateCurrentPageSelection(event: Event): void {
  selectedSourceIds.value = (event.target as HTMLInputElement).checked ? [...enabledPageSourceIds.value] : []
}

/**
 * 打开批量禁用二次确认框。
 * @returns 无返回值。
 */
function requestBatchDisable(): void {
  if (selectedSourceIds.value.length > 0) batchDisableConfirmationOpen.value = true
}

/** @param input 已校验粘贴文本与初始关联。 @returns 创建与刷新结束时完成。 */
async function createPastedSource(input: CreateSourceWithTargetsInput): Promise<void> {
  await runImport(async () => {
    await $fetch<ApiResponse<SourceDetails>>('/api/v1/sources', { method: 'POST', body: input })
  })
}

/**
 * 逐个导入所选文件，保留成功项并汇总每个失败文件。
 * @param input 共用用途、关联对象和带独立名称的文件列表。
 * @returns 全部文件处理和资料列表刷新结束时完成。
 */
async function importFiles(input: SourceFileSubmission): Promise<void> {
  loading.value = true
  errorMessage.value = null
  let succeeded = 0
  const failures: string[] = []
  try {
    for (const item of input.files) {
      const body = new FormData()
      body.set('name', item.name)
      body.set('role', input.role)
      body.set('targets', JSON.stringify(input.targets))
      body.set('file', item.file)
      try {
        await $fetch<ApiResponse<SourceDetails>>('/api/v1/sources/files', { method: 'POST', body })
        succeeded += 1
      }
      catch (requestError: unknown) {
        failures.push(`${item.file.name}：${getApiErrorMessage(requestError, '导入失败')}`)
      }
    }
    if (succeeded > 0) await refreshFirstPage()
    if (failures.length === 0) {
      showImport.value = false
      return
    }
    errorMessage.value = `成功 ${succeeded} 个，失败 ${failures.length} 个。${failures.join('；')}`
  }
  finally {
    loading.value = false
  }
}

/** @returns FTS5 查询完成时结束。 */
async function searchSources(): Promise<void> {
  if (!searchQuery.value.trim()) return
  loading.value = true
  errorMessage.value = null
  try {
    const response = await $fetch<ApiResponse<SourceChunkView[]>>('/api/v1/sources/search', {
      query: { query: searchQuery.value, limit: 20 },
    })
    searchResults.value = response.data
  }
  catch (requestError: unknown) {
    errorMessage.value = getApiErrorMessage(requestError, '资料检索失败')
  }
  finally {
    loading.value = false
  }
}

/** @param action 单次创建或上传动作。 @returns 动作与列表刷新结束时完成。 */
async function runImport(action: () => Promise<void>): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    await action()
    showImport.value = false
    await refreshFirstPage()
  }
  catch (requestError: unknown) {
    errorMessage.value = getApiErrorMessage(requestError, '资料导入失败')
  }
  finally {
    loading.value = false
  }
}

/**
 * 导入成功后回到第一页，确保用户能看到按更新时间排在最前的新资料。
 * @returns 路由更新或当前页刷新完成时结束。
 */
async function refreshFirstPage(): Promise<void> {
  if (sourcePage.value.page === 1) {
    await refresh()
    return
  }
  await updatePagination(1, sourcePage.value.pageSize)
}

/**
 * 把分页状态写入 URL，由响应式分页请求自动加载对应数据。
 * @param page 新页码。
 * @param pageSize 新每页数量。
 * @returns 路由导航完成时结束。
 */
async function updatePagination(page: number, pageSize: 5 | 10 | 20 | 50 | 100): Promise<void> {
  await navigateTo({
    path: route.path,
    query: { ...route.query, page: String(page), pageSize: String(pageSize) },
  })
}

/**
 * 切换资料页码。
 * @param page 分页组件返回的新页码。
 * @returns 路由导航完成时结束。
 */
async function changePage(page: number): Promise<void> {
  await updatePagination(page, sourcePage.value.pageSize)
}

/**
 * 切换每页数量并回到第一页。
 * @param value 选择组件返回的每页数量。
 * @returns 路由导航完成时结束。
 */
async function changePageSize(value: number | string): Promise<void> {
  await updatePagination(1, readPageSize(value))
}

/**
 * 在二次确认后批量禁用当前页勾选资料。
 * @returns 批量状态请求和当前页刷新完成时结束。
 */
async function confirmBatchDisable(): Promise<void> {
  const sourceIds = [...selectedSourceIds.value]
  if (sourceIds.length === 0) return
  batchDisabling.value = true
  errorMessage.value = null
  try {
    await $fetch<ApiResponse<SourceStatusUpdateResult>>('/api/v1/sources/status', {
      method: 'PATCH',
      body: { sourceIds, isEnabled: false },
    })
    batchDisableConfirmationOpen.value = false
    clearSourceSelection()
    await refresh()
  }
  catch (requestError: unknown) {
    errorMessage.value = getApiErrorMessage(requestError, '批量禁用资料失败')
  }
  finally {
    batchDisabling.value = false
  }
}
</script>

<template>
  <div>
    <ContentPageHeader title="资料库" description="统一导入、检索和维护人物或世界会参考的事实、背景与风格资料。">
      <UButton icon="i-lucide-plus" @click="showImport = !showImport">{{ showImport ? '收起导入' : '导入资料' }}</UButton>
    </ContentPageHeader>
    <div class="status-strip page-status-strip" aria-label="资料状态摘要">
      <div class="status-cell"><span class="status-kicker">全部资料</span><strong class="status-value">{{ sourcePage.total }}</strong></div>
      <div class="status-cell"><span class="status-kicker">本页启用</span><strong class="status-value">{{ enabledSourceCount }} / {{ sources.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">本页可检索段落</span><strong class="status-value">{{ chunkCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">本页已建立关系</span><strong class="status-value">{{ linkedSourceCount }}</strong><span class="status-note">文件资料 {{ fileSourceCount }} 项</span></div>
    </div>
    <UAlert v-if="showImport && (personaError || worldError)" class="mt-6" color="warning" title="部分关联对象加载失败" description="仍可不选择人物或世界，直接把资料保存到资料库。" />
    <ContentSourceImportForm
      v-if="showImport"
      class="mt-6 mb-7"
      :loading="loading"
      :error-message="errorMessage"
      :personas="personas"
      :worlds="worlds"
      show-target-picker
      @paste="createPastedSource"
      @file="importFiles"
    />
    <UAlert v-if="errorMessage && !showImport" class="mt-6" color="error" title="操作失败" :description="errorMessage" />

    <section class="content-section" aria-labelledby="source-search-heading">
      <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">资料检索</p><h2 id="source-search-heading">查找资料中的事实与段落</h2><p>输入一句话或关键词，返回本地事实库中最相关的可追溯段落。</p></div></div>
      <form class="content-toolbar" @submit.prevent="searchSources">
        <UInput v-model="searchQuery" class="flex-1" placeholder="输入资料中的短语" aria-label="资料检索词" />
        <UButton type="submit" color="neutral" variant="soft" :loading="loading">检索</UButton>
      </form>
      <div v-if="searchResults" class="mt-4 space-y-3">
          <p v-if="searchResults.length === 0" class="text-sm text-muted">没有找到相关段落。</p>
        <div v-for="chunk in searchResults" :key="chunk.id" class="archive-panel">
          <p class="text-xs font-medium text-primary">{{ chunk.heading || '无标题' }} · 第 {{ chunk.ordinal + 1 }} 段</p>
          <p class="mt-1 whitespace-pre-wrap text-sm text-muted">{{ chunk.content }}</p>
          <UButton :to="`/sources/${chunk.sourceId}`" color="neutral" variant="link" size="sm" class="mt-1 px-0">查看资料</UButton>
        </div>
      </div>
    </section>

    <UAlert v-if="error" color="error" title="资料列表加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <section v-else-if="sources.length" class="content-section" aria-labelledby="source-list-heading">
      <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">处理与关系</p><h2 id="source-list-heading">资料内容、检索段落与使用范围</h2><p>资料正文保存在 SQLite；关联关系决定它会进入哪个世界或人物的上下文。</p></div></div>
      <div class="content-table-wrap">
        <div class="content-toolbar border-b border-default">
          <span class="text-sm text-muted">已选择 {{ selectedSourceIds.length }} 项已启用资料</span>
          <UButton color="error" variant="soft" :disabled="selectedSourceIds.length === 0" @click="requestBatchDisable">批量禁用</UButton>
        </div>
        <table class="content-table">
          <thead><tr><th><input type="checkbox" aria-label="选择当前页全部已启用资料" :checked="allEnabledPageSourcesSelected" :indeterminate="someEnabledPageSourcesSelected" :disabled="enabledPageSourceIds.length === 0" @change="updateCurrentPageSelection"></th><th>资料</th><th>用途</th><th>状态</th><th>检索内容</th><th>使用关系</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="source in sources" :key="source.id">
              <td data-label="选择"><input type="checkbox" :aria-label="`选择资料：${source.name}`" :checked="selectedSourceIds.includes(source.id)" :disabled="!source.isEnabled" @change="updateSourceSelection(source.id, $event)"></td>
              <td data-label="资料"><strong class="content-table-title">{{ source.name }}</strong><span class="content-table-description">{{ source.contentText.slice(0, 120) }}{{ source.contentText.length > 120 ? '…' : '' }}</span></td>
              <td data-label="用途"><UBadge color="neutral" variant="subtle">{{ roleLabels[source.role] }}</UBadge><span class="content-table-description">{{ source.inputType === 'paste' ? '粘贴文本' : source.inputType.toUpperCase() + ' 文件' }}</span></td>
              <td data-label="状态"><UBadge :color="source.isEnabled ? 'success' : 'neutral'" variant="subtle">{{ source.isEnabled ? '已启用' : '已禁用' }}</UBadge></td>
              <td data-label="检索内容">{{ source.chunkCount }} 个段落</td>
              <td data-label="使用关系">{{ source.linkCount }} 个对象</td>
              <td data-label="操作"><UButton :to="`/sources/${source.id}`" color="neutral" variant="link">查看与维护</UButton></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="mt-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <p class="text-sm text-muted">第 {{ sourcePage.page }} / {{ sourcePage.totalPages }} 页，共 {{ sourcePage.total }} 项</p>
        <div class="flex flex-wrap items-center gap-3">
          <USelect :model-value="sourcePage.pageSize" class="w-34" :items="pageSizeItems" aria-label="每页资料数量" @update:model-value="changePageSize" />
          <UPagination :page="sourcePage.page" :total="sourcePage.total" :items-per-page="sourcePage.pageSize" show-edges @update:page="changePage" />
        </div>
      </div>
    </section>
    <div v-else class="content-empty-state"><div><strong>还没有资料</strong><p>可以先创建原创人物，也可以从粘贴文本、TXT 或 Markdown 开始导入。</p></div></div>

    <UModal v-model:open="batchDisableConfirmationOpen" title="确认批量禁用资料" description="禁用后资料正文和使用关系仍会保留。">
      <template #body>
        <p class="text-sm text-muted">确定禁用当前页已选择的 {{ selectedSourceIds.length }} 项资料吗？这些资料将停止进入人物和世界检索，并删除对应 OpenViking 投影。</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="batchDisabling" @click="batchDisableConfirmationOpen = false">取消</UButton>
          <UButton color="error" :loading="batchDisabling" @click="confirmBatchDisable">确认禁用</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
