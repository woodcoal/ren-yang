<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { WorldDetails, WorldDraftView, WorldPageView, WorldStatusUpdateResult } from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

const route = useRoute()

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

const requestedPage = computed(() => readPositiveInteger(route.query.page, 1))
const requestedPageSize = computed(() => readPageSize(route.query.pageSize))
const worldPageQuery = computed(() => ({ page: requestedPage.value, pageSize: requestedPageSize.value }))
const { data, error, refresh } = await useFetch<ApiResponse<WorldPageView>>('/api/v1/worlds/page', { query: worldPageQuery })
const worldPage = computed<WorldPageView>(() => data.value?.data ?? {
  items: [], total: 0, page: requestedPage.value, pageSize: requestedPageSize.value, totalPages: 1,
})
const worlds = computed(() => worldPage.value.items)
const usableWorldCount = computed(() => worlds.value.filter(world => world.isEnabled && world.activeVersionId).length)
const pendingWorldCount = computed(() => worlds.value.filter(world => world.isEnabled && !world.activeVersionId).length)
const disabledWorldCount = computed(() => worlds.value.filter(world => !world.isEnabled).length)
const showCreate = shallowRef(false)
const loading = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)
const actionErrorMessage = shallowRef<string | null>(null)
const selectedWorldIds = ref<string[]>([])
const batchDisableConfirmationOpen = shallowRef(false)
const batchStatusUpdating = shallowRef<boolean | null>(null)
const pageWorldIds = computed(() => worlds.value.map(world => world.id))
const selectedEnabledWorldIds = computed(() => worlds.value
  .filter(world => world.isEnabled && selectedWorldIds.value.includes(world.id)).map(world => world.id))
const selectedDisabledWorldIds = computed(() => worlds.value
  .filter(world => !world.isEnabled && selectedWorldIds.value.includes(world.id)).map(world => world.id))
const allPageWorldsSelected = computed(() => pageWorldIds.value.length > 0
  && pageWorldIds.value.every(worldId => selectedWorldIds.value.includes(worldId)))
const somePageWorldsSelected = computed(() => selectedWorldIds.value.length > 0 && !allPageWorldsSelected.value)

/** 可选择的每页世界数量。 */
const pageSizeItems = [
  { label: '每页 5 条', value: 5 }, { label: '每页 10 条', value: 10 }, { label: '每页 20 条', value: 20 },
  { label: '每页 50 条', value: 50 }, { label: '每页 100 条', value: 100 },
]

/** @returns 清空当前页勾选，避免分页后误操作上一页对象。 */
function clearWorldSelection(): void {
  selectedWorldIds.value = []
}

watch([requestedPage, requestedPageSize], clearWorldSelection)

/** @param worldId 当前页世界 UUID。 @param event 复选框变更事件。 @returns 无返回值。 */
function updateWorldSelection(worldId: string, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  selectedWorldIds.value = checked
    ? [...new Set([...selectedWorldIds.value, worldId])]
    : selectedWorldIds.value.filter(value => value !== worldId)
}

/** @param event 表头复选框变更事件。 @returns 选择或取消选择当前页全部世界。 */
function updateCurrentPageSelection(event: Event): void {
  selectedWorldIds.value = (event.target as HTMLInputElement).checked ? [...pageWorldIds.value] : []
}

/** @param prompt 用户确认的世界描述。 @returns 生成、创建和导航全部完成时结束。 */
async function createWorld(prompt: string): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    const draft = await $fetch<ApiResponse<WorldDraftView>>('/api/v1/worlds/draft', { method: 'POST', body: { prompt } })
    const created = await $fetch<ApiResponse<WorldDetails>>('/api/v1/worlds', {
      method: 'POST', body: {
        name: draft.data.name, summary: draft.data.summary, snapshot: draft.data.snapshot,
        changeSummary: '根据自然语言生成初始世界灵魂草稿',
      },
    })
    await navigateTo(`/worlds/${created.data.world.id}`)
  }
  catch (requestError: unknown) {
    errorMessage.value = getApiErrorMessage(requestError, '世界设定创建失败')
  }
  finally {
    loading.value = false
  }
}

/** @param worldIds 待修改世界 UUID。 @param isEnabled 统一状态。 @returns 请求是否成功。 */
async function updateSelectedWorldsStatus(worldIds: string[], isEnabled: boolean): Promise<boolean> {
  if (worldIds.length === 0 || batchStatusUpdating.value !== null) return false
  batchStatusUpdating.value = isEnabled
  actionErrorMessage.value = null
  try {
    await $fetch<ApiResponse<WorldStatusUpdateResult>>('/api/v1/worlds/status', {
      method: 'PATCH', body: { worldIds, isEnabled },
    })
    clearWorldSelection()
    await refresh()
    return true
  }
  catch (requestError: unknown) {
    actionErrorMessage.value = getApiErrorMessage(requestError, isEnabled ? '批量启用世界失败' : '批量禁用世界失败')
    return false
  }
  finally {
    batchStatusUpdating.value = null
  }
}

/** @returns 批量启用当前选择结束时完成。 */
async function enableSelectedWorlds(): Promise<void> {
  await updateSelectedWorldsStatus(selectedDisabledWorldIds.value, true)
}

/** @returns 有可禁用世界时打开二次确认框。 */
function requestBatchDisable(): void {
  if (selectedEnabledWorldIds.value.length > 0) batchDisableConfirmationOpen.value = true
}

/** @returns 用户确认后的批量禁用和弹窗关闭结束时完成。 */
async function confirmBatchDisable(): Promise<void> {
  if (await updateSelectedWorldsStatus(selectedEnabledWorldIds.value, false)) batchDisableConfirmationOpen.value = false
}

/** @param page 新页码。 @param pageSize 新每页数量。 @returns 路由导航完成时结束。 */
async function updatePagination(page: number, pageSize: 5 | 10 | 20 | 50 | 100): Promise<void> {
  await navigateTo({ path: route.path, query: { ...route.query, page: String(page), pageSize: String(pageSize) } })
}

/** @param page 新页码。 @returns 路由导航完成时结束。 */
async function changePage(page: number): Promise<void> {
  await updatePagination(page, worldPage.value.pageSize)
}

/** @param pageSize 新每页数量。 @returns 回到第一页的路由导航完成时结束。 */
async function changePageSize(pageSize: number): Promise<void> {
  await updatePagination(1, readPageSize(pageSize))
}
</script>

<template>
  <div>
    <ContentPageHeader title="世界设定" description="世界是相关人物共用的背景与规则；人物也可以不关联世界，独立完成任务。">
      <ContentQuickCreateSubjectModal v-model:open="showCreate" subject-type="world" :loading="loading"
        :error-message="errorMessage" @submit="createWorld">
        <UButton icon="i-lucide-plus">创建世界</UButton>
      </ContentQuickCreateSubjectModal>
    </ContentPageHeader>

    <div class="status-strip page-status-strip" aria-label="世界状态摘要">
      <div class="status-cell"><span class="status-kicker">全部世界</span><strong class="status-value">{{ worldPage.total }}</strong></div>
      <div class="status-cell"><span class="status-kicker">本页可使用</span><strong class="status-value">{{ usableWorldCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">本页待确认</span><strong class="status-value">{{ pendingWorldCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">本页已禁用</span><strong class="status-value">{{ disabledWorldCount }}</strong></div>
    </div>

    <UAlert v-if="actionErrorMessage" class="mb-5" color="error" title="操作失败" :description="actionErrorMessage" />
    <UAlert v-if="error" color="error" title="世界列表加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <section v-else-if="worlds.length" class="content-section" aria-labelledby="world-list-heading">
      <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">世界列表</p><h2 id="world-list-heading">已建立的世界设定</h2><p>禁用后不再进入后续新任务，历史版本、人物关系和资料仍会保留。</p></div></div>
      <div class="content-toolbar !rounded-none !bg-transparent !border-0">
        <span v-if="selectedWorldIds.length > 0" class="text-sm text-muted">已选择 {{ selectedWorldIds.length }} 个世界</span><span v-else aria-hidden="true"></span>
        <div class="flex items-center justify-end gap-1">
          <UButton color="success" variant="ghost" size="xs" :loading="batchStatusUpdating === true"
            :disabled="selectedDisabledWorldIds.length === 0 || batchStatusUpdating !== null" @click="enableSelectedWorlds">批量启用</UButton>
          <UButton color="error" variant="ghost" size="xs" :disabled="selectedEnabledWorldIds.length === 0 || batchStatusUpdating !== null"
            @click="requestBatchDisable">批量禁用</UButton>
        </div>
      </div>
      <div class="content-table-wrap">
        <table class="content-table">
          <thead><tr><th><input type="checkbox" aria-label="选择当前页全部世界" :checked="allPageWorldsSelected"
            :indeterminate="somePageWorldsSelected" :disabled="pageWorldIds.length === 0" @change="updateCurrentPageSelection"></th>
            <th>世界</th><th>使用关系</th><th>版本</th><th>启用状态</th><th>设定状态</th><th>操作</th></tr></thead>
          <tbody><tr v-for="world in worlds" :key="world.id">
            <td data-label="选择"><input type="checkbox" :aria-label="`选择世界：${world.name}`" :checked="selectedWorldIds.includes(world.id)" @change="updateWorldSelection(world.id, $event)"></td>
            <td data-label="世界"><strong class="content-table-title">{{ world.name }}</strong><span class="content-table-description">{{ world.summary || '未填写摘要' }}</span></td>
            <td data-label="使用关系"><span>{{ world.personaCount }} 个人物</span><span class="content-table-description">{{ world.sourceCount }} 项资料</span></td>
            <td data-label="版本">{{ world.versionCount }} 条修改记录</td>
            <td data-label="启用状态"><UBadge :color="world.isEnabled ? 'success' : 'neutral'" variant="subtle">{{ world.isEnabled ? '已启用' : '已禁用' }}</UBadge></td>
            <td data-label="设定状态"><UBadge :color="world.activeVersionId ? 'success' : 'warning'" variant="subtle">{{ world.activeVersionId ? '已有可用设定' : '等待确认设定' }}</UBadge></td>
            <td data-label="操作"><UButton :to="`/worlds/${world.id}`" color="neutral" variant="ghost" size="xs"
              icon="i-lucide-chevron-right" :aria-label="`查看与维护：${world.name}`" /></td>
          </tr></tbody>
        </table>
      </div>
      <div class="mt-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <p class="text-sm text-muted">第 {{ worldPage.page }} / {{ worldPage.totalPages }} 页，共 {{ worldPage.total }} 项</p>
        <div class="flex flex-wrap items-center gap-3">
          <USelect :model-value="worldPage.pageSize" class="w-34" :items="pageSizeItems" aria-label="每页世界数量" @update:model-value="changePageSize" />
          <UPagination :page="worldPage.page" :total="worldPage.total" :items-per-page="worldPage.pageSize" show-edges @update:page="changePage" />
        </div>
      </div>
    </section>
    <div v-else class="content-empty-state"><div><strong>还没有世界设定</strong><p>独立人物仍可正常创建和执行任务。</p></div></div>

    <UModal v-model:open="batchDisableConfirmationOpen" title="确认批量禁用世界" description="世界版本、人物关系、资料和历史记录仍会保留。">
      <template #body><p class="text-sm text-muted">确定禁用当前页已选择的 {{ selectedEnabledWorldIds.length }} 个启用世界吗？这些世界将停止进入后续新任务。</p></template>
      <template #footer><div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :disabled="batchStatusUpdating !== null" @click="batchDisableConfirmationOpen = false">取消</UButton>
        <UButton color="error" :loading="batchStatusUpdating === false" @click="confirmBatchDisable">确认禁用</UButton>
      </div></template>
    </UModal>
  </div>
</template>
