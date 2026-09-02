<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { QuickCreateSubjectInput } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { SoulSnapshot, WorldDetails, WorldPageView, WorldStatusUpdateResult } from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

const route = useRoute()
const { runWithAiLoading } = useAiLoading()
const { notifySuccess, notifyError } = useOperationNotifications()

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

/**
 * 从 URL 查询参数读取单个去除首尾空白的文本值。
 * @param value 路由查询参数原值。
 * @returns 可用于世界名称筛选的文本。
 */
function readTextQuery(value: unknown): string {
  const normalized = Array.isArray(value) ? value[0] : value
  return typeof normalized === 'string' ? normalized.trim() : ''
}

const requestedPage = computed(() => readPositiveInteger(route.query.page, 1))
const requestedPageSize = computed(() => readPageSize(route.query.pageSize))
const requestedWorldFilter = computed(() => readTextQuery(route.query.keyword))
const worldPageQuery = computed(() => ({
  page: requestedPage.value,
  pageSize: requestedPageSize.value,
  query: requestedWorldFilter.value || undefined,
}))
const { data, error, refresh } = await useFetch<ApiResponse<WorldPageView>>('/api/v1/worlds/page', { query: worldPageQuery })
const worldPage = computed<WorldPageView>(() => data.value?.data ?? {
  items: [], total: 0, page: requestedPage.value, pageSize: requestedPageSize.value, totalPages: 1,
})
const worlds = computed(() => worldPage.value.items)
const showCreate = shallowRef(false)
const loading = shallowRef(false)
const worldFilterInput = shallowRef(requestedWorldFilter.value)
const selectedWorldIds = ref<string[]>([])
const batchEnableConfirmationOpen = shallowRef(false)
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

watch([requestedPage, requestedPageSize, requestedWorldFilter], clearWorldSelection)

/**
 * 浏览器前进或后退改变筛选参数时同步世界筛选输入框。
 * @param query URL 中当前世界名称筛选词。
 * @returns 输入框同步完成时结束。
 */
function synchronizeWorldFilter(query: string): void {
  worldFilterInput.value = query
}

watch(requestedWorldFilter, synchronizeWorldFilter)

/**
 * 按输入的世界名称筛选全部世界并回到第一页。
 * @returns URL 筛选参数更新完成时结束。
 */
async function applyWorldFilter(): Promise<void> {
  const keyword = worldFilterInput.value.trim()
  await navigateTo({
    path: route.path,
    query: {
      page: '1',
      pageSize: String(worldPage.value.pageSize),
      ...(keyword ? { keyword } : {}),
    },
  })
}

/**
 * 清空世界名称筛选并重新显示第一页全部世界。
 * @returns URL 筛选参数清除完成时结束。
 */
async function clearWorldFilter(): Promise<void> {
  worldFilterInput.value = ''
  await applyWorldFilter()
}

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

/**
 * 按用户选择直接保存原文或先用 AI 整理，再创建世界当前灵魂并进入详情。
 * @param input 用户确认的世界名称、灵魂提示词和整理方式。
 * @returns 整理、创建和导航全部完成时结束。
 */
async function createWorld(input: QuickCreateSubjectInput): Promise<void> {
  loading.value = true
  try {
    let snapshot: SoulSnapshot = { promptText: input.promptText }
    if (input.autoAnalyze) {
      const analyzed = await runWithAiLoading({
        title: 'AI 正在整理世界灵魂',
        description: '模型正在把原始设定整理为清晰、可执行的世界提示词，可能需要几十秒。',
        completionHint: '整理完成后将继续创建世界并自动进入详情页。',
      }, async () => await $fetch<ApiResponse<SoulSnapshot>>('/api/v1/soul/analyze', {
        method: 'POST', body: { subjectType: 'world', promptText: input.promptText },
      }))
      snapshot = analyzed.data
    }
    const created = await $fetch<ApiResponse<WorldDetails>>('/api/v1/worlds', {
      method: 'POST', body: {
        name: input.name, summary: '', snapshot,
        changeSummary: input.autoAnalyze ? 'AI 整理初始世界灵魂' : '按原文建立初始世界灵魂',
      },
    })
    notifySuccess(`世界“${created.data.world.name}”已创建。`, '世界创建完成')
    await navigateTo(`/worlds/${created.data.world.id}`)
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, '世界创建失败'), '世界创建失败')
  }
  finally {
    loading.value = false
  }
}

/** @param worldIds 待修改世界 UUID。 @param isEnabled 统一状态。 @returns 请求是否成功。 */
async function updateSelectedWorldsStatus(worldIds: string[], isEnabled: boolean): Promise<boolean> {
  if (worldIds.length === 0 || batchStatusUpdating.value !== null) return false
  batchStatusUpdating.value = isEnabled
  try {
    await $fetch<ApiResponse<WorldStatusUpdateResult>>('/api/v1/worlds/status', {
      method: 'PATCH', body: { worldIds, isEnabled },
    })
    clearWorldSelection()
    await refresh()
    notifySuccess(`已${isEnabled ? '启用' : '禁用'} ${worldIds.length} 个世界。`)
    return true
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, isEnabled ? '批量启用世界失败' : '批量禁用世界失败'))
    return false
  }
  finally {
    batchStatusUpdating.value = null
  }
}

/** @returns 有可启用世界时打开二次确认框。 */
function requestBatchEnable(): void {
  if (selectedDisabledWorldIds.value.length > 0) batchEnableConfirmationOpen.value = true
}

/** @returns 用户确认后的批量启用和弹窗关闭结束时完成。 */
async function confirmBatchEnable(): Promise<void> {
  if (await updateSelectedWorldsStatus(selectedDisabledWorldIds.value, true)) batchEnableConfirmationOpen.value = false
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
    <ContentPageHeader title="世界" description="世界是相关人物共用的背景与规则；人物也可以不关联世界，独立完成任务。">
      <ContentQuickCreateSubjectModal v-model:open="showCreate" subject-type="world" :loading="loading"
        :error-message="null" @submit="createWorld">
        <UButton icon="i-lucide-plus">创建世界</UButton>
      </ContentQuickCreateSubjectModal>
    </ContentPageHeader>

    <UAlert v-if="error" color="error" title="世界列表加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />

    <section v-else class="content-section" aria-labelledby="world-list-heading">
      <h2 id="world-list-heading" class="visually-hidden">世界列表</h2>
      <div class="list-management-panel">
        <div class="list-management-controls">
          <form class="list-management-search" aria-label="筛选世界" @submit.prevent="applyWorldFilter">
            <UInput v-model="worldFilterInput" class="list-management-search-input" icon="i-lucide-search"
              placeholder="输入世界名称" aria-label="世界列表搜索词" />
            <UButton type="submit" color="neutral" variant="soft">搜索世界</UButton>
            <UButton v-if="requestedWorldFilter" type="button" color="neutral" variant="ghost"
              @click="clearWorldFilter">清除筛选</UButton>
          </form>
          <div v-if="worlds.length" class="list-management-batch">
            <span class="list-management-selection">{{ selectedWorldIds.length > 0
              ? `已选择 ${selectedWorldIds.length} 个世界`
              : '选择世界后可批量操作' }}</span>
            <div class="list-management-batch-actions">
              <UButton color="success" variant="soft" size="xs" icon="i-lucide-circle-check"
                :loading="batchStatusUpdating === true"
                :disabled="selectedDisabledWorldIds.length === 0 || batchStatusUpdating !== null"
                @click="requestBatchEnable">批量启用</UButton>
              <UButton color="error" variant="soft" size="xs" icon="i-lucide-circle-off"
                :disabled="selectedEnabledWorldIds.length === 0 || batchStatusUpdating !== null"
                @click="requestBatchDisable">批量禁用</UButton>
            </div>
          </div>
        </div>

        <template v-if="worlds.length">
          <div class="content-table-wrap list-management-table">
            <table class="content-table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="选择当前页全部世界" :checked="allPageWorldsSelected"
                  :indeterminate="somePageWorldsSelected" :disabled="pageWorldIds.length === 0"
                  @change="updateCurrentPageSelection"></th>
              <th>世界</th>
              <th>使用关系</th>
              <th>版本</th>
              <th>启用状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="world in worlds" :key="world.id">
              <td data-label="选择"><input type="checkbox" :aria-label="`选择世界：${world.name}`"
                  :checked="selectedWorldIds.includes(world.id)" @change="updateWorldSelection(world.id, $event)"></td>
              <td data-label="世界">
                <NuxtLink :to="`/worlds/${world.id}`" data-world-title-link class="content-table-title hover:underline">
                  <strong>{{ world.name }}</strong>
                </NuxtLink><span class="content-table-description line-clamp-2 whitespace-pre-wrap">{{ world.summary
                  || '未填写摘要' }}</span>
              </td>
              <td data-label="使用关系"><span>{{ world.personaCount }} 个人物</span><span class="content-table-description">{{
                world.sourceCount }} 项资料</span></td>
              <td data-label="版本">{{ world.versionCount }} 条修改记录</td>
              <td data-label="启用状态">
                <UBadge :color="world.isEnabled ? 'success' : 'neutral'" variant="subtle">{{ world.isEnabled ? '已启用' :
                  '已禁用' }}</UBadge>
              </td>
              <td data-label="操作">
                <UButton :to="`/worlds/${world.id}`" color="neutral" variant="ghost" size="xs"
                  icon="i-lucide-chevron-right" :aria-label="`查看与维护：${world.name}`" />
              </td>
            </tr>
          </tbody>
            </table>
          </div>
          <div class="list-management-footer">
            <p class="m-0 text-sm text-muted">第 {{ worldPage.page }} / {{ worldPage.totalPages }} 页，共 {{ worldPage.total }} 项</p>
            <div class="list-management-pagination">
              <USelect :model-value="worldPage.pageSize" class="w-34" :items="pageSizeItems" aria-label="每页世界数量"
                @update:model-value="changePageSize" />
              <UPagination :page="worldPage.page" :total="worldPage.total" :items-per-page="worldPage.pageSize" show-edges
                @update:page="changePage" />
            </div>
          </div>
        </template>
        <div v-else class="content-empty-state list-management-empty">
          <div><strong>{{ requestedWorldFilter ? '没有匹配的世界' : '还没有世界' }}</strong>
            <p>{{ requestedWorldFilter ? '请调整世界名称关键词后重试。' : '独立人物仍可正常创建和执行任务。' }}</p>
            <UButton v-if="requestedWorldFilter" class="mt-4" color="neutral" variant="soft"
              @click="clearWorldFilter">清除筛选</UButton>
          </div>
        </div>
      </div>
    </section>

    <UModal v-model:open="batchEnableConfirmationOpen" title="确认批量启用世界" description="启用后，这些世界可以重新进入后续新任务。">
      <template #body>
        <p class="text-sm text-muted">确定启用当前页已选择的 {{ selectedDisabledWorldIds.length }} 个禁用世界吗？</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="batchStatusUpdating !== null"
            @click="batchEnableConfirmationOpen = false">取消</UButton>
          <UButton color="success" :loading="batchStatusUpdating === true" @click="confirmBatchEnable">确认启用</UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="batchDisableConfirmationOpen" title="确认批量禁用世界" description="世界版本、人物关系、资料和历史记录仍会保留。">
      <template #body>
        <p class="text-sm text-muted">确定禁用当前页已选择的 {{ selectedEnabledWorldIds.length }} 个启用世界吗？这些世界将停止进入后续新任务。</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="batchStatusUpdating !== null"
            @click="batchDisableConfirmationOpen = false">取消</UButton>
          <UButton color="error" :loading="batchStatusUpdating === false" @click="confirmBatchDisable">确认禁用</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
