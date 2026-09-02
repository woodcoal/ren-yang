<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { CreatePersonaInput } from '#shared/schemas/content'
import type { CreatePersonaDistillationInput } from '#shared/schemas/personaDistillation'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaDetails, PersonaPageView, PersonaStatusUpdateResult, SourceSummary, WorldSummary } from '#shared/types/content'
import type { PersonaDistillationRunView } from '#shared/types/personaDistillation'
import { getApiErrorMessage } from '../../utils/apiError'

const route = useRoute()
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
 * @returns 可用于人物名称筛选的文本。
 */
function readTextQuery(value: unknown): string {
  const normalized = Array.isArray(value) ? value[0] : value
  return typeof normalized === 'string' ? normalized.trim() : ''
}

const requestedPage = computed(() => readPositiveInteger(route.query.page, 1))
const requestedPageSize = computed(() => readPageSize(route.query.pageSize))
const requestedPersonaFilter = computed(() => readTextQuery(route.query.keyword))
const personaPageQuery = computed(() => ({
  page: requestedPage.value,
  pageSize: requestedPageSize.value,
  query: requestedPersonaFilter.value || undefined,
}))
const { data, error, refresh } = await useFetch<ApiResponse<PersonaPageView>>('/api/v1/personas/page', { query: personaPageQuery })
const [{ data: worldData }, { data: sourceData }] = await Promise.all([
  useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds'),
  useFetch<ApiResponse<SourceSummary[]>>('/api/v1/sources'),
])
const personaPage = computed<PersonaPageView>(() => data.value?.data ?? {
  items: [], total: 0, page: requestedPage.value, pageSize: requestedPageSize.value, totalPages: 1,
})
const personas = computed(() => personaPage.value.items)
const worlds = computed(() => worldData.value?.data ?? [])
const sources = computed(() => sourceData.value?.data ?? [])
const showManualCreate = shallowRef(false)
const manualCreateLoading = shallowRef(false)
const manualCreateError = shallowRef<string | null>(null)
const showDistillationCreate = shallowRef(false)
const distillationCreateLoading = shallowRef(false)
const distillationCreateError = shallowRef<string | null>(null)
const personaFilterInput = shallowRef(requestedPersonaFilter.value)
const selectedPersonaIds = ref<string[]>([])
const batchEnableConfirmationOpen = shallowRef(false)
const batchDisableConfirmationOpen = shallowRef(false)
const batchStatusUpdating = shallowRef<boolean | null>(null)
const pagePersonaIds = computed(() => personas.value.map(persona => persona.id))
const selectedEnabledPersonaIds = computed(() => personas.value
  .filter(persona => persona.isEnabled && selectedPersonaIds.value.includes(persona.id)).map(persona => persona.id))
const selectedDisabledPersonaIds = computed(() => personas.value
  .filter(persona => !persona.isEnabled && selectedPersonaIds.value.includes(persona.id)).map(persona => persona.id))
const allPagePersonasSelected = computed(() => pagePersonaIds.value.length > 0
  && pagePersonaIds.value.every(personaId => selectedPersonaIds.value.includes(personaId)))
const somePagePersonasSelected = computed(() => selectedPersonaIds.value.length > 0 && !allPagePersonasSelected.value)

/** 可选择的每页人物数量。 */
const pageSizeItems = [
  { label: '每页 5 条', value: 5 }, { label: '每页 10 条', value: 10 }, { label: '每页 20 条', value: 20 },
  { label: '每页 50 条', value: 50 }, { label: '每页 100 条', value: 100 },
]

/** @returns 清空当前页勾选，避免分页后误操作上一页对象。 */
function clearPersonaSelection(): void {
  selectedPersonaIds.value = []
}

watch([requestedPage, requestedPageSize, requestedPersonaFilter], clearPersonaSelection)

/**
 * 浏览器前进或后退改变筛选参数时同步人物筛选输入框。
 * @param query URL 中当前人物名称筛选词。
 * @returns 输入框同步完成时结束。
 */
function synchronizePersonaFilter(query: string): void {
  personaFilterInput.value = query
}

watch(requestedPersonaFilter, synchronizePersonaFilter)

/**
 * 按输入的人物名称筛选全部人物并回到第一页。
 * @returns URL 筛选参数更新完成时结束。
 */
async function applyPersonaFilter(): Promise<void> {
  const keyword = personaFilterInput.value.trim()
  await navigateTo({
    path: route.path,
    query: {
      page: '1',
      pageSize: String(personaPage.value.pageSize),
      ...(keyword ? { keyword } : {}),
    },
  })
}

/**
 * 清空人物名称筛选并重新显示第一页全部人物。
 * @returns URL 筛选参数清除完成时结束。
 */
async function clearPersonaFilter(): Promise<void> {
  personaFilterInput.value = ''
  await applyPersonaFilter()
}

/** @param personaId 当前页人物 UUID。 @param event 复选框变更事件。 @returns 无返回值。 */
function updatePersonaSelection(personaId: string, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  selectedPersonaIds.value = checked
    ? [...new Set([...selectedPersonaIds.value, personaId])]
    : selectedPersonaIds.value.filter(value => value !== personaId)
}

/** @param event 表头复选框变更事件。 @returns 选择或取消选择当前页全部人物。 */
function updateCurrentPageSelection(event: Event): void {
  selectedPersonaIds.value = (event.target as HTMLInputElement).checked ? [...pagePersonaIds.value] : []
}

/** @returns 打开手动人物创建弹窗并清除上一次请求错误。 */
function openManualCreateModal(): void {
  manualCreateError.value = null
  showManualCreate.value = true
}

/** @returns 打开 AI 人物蒸馏弹窗并清除上一次请求错误。 */
function openDistillationCreateModal(): void {
  distillationCreateError.value = null
  showDistillationCreate.value = true
}

/**
 * 不调用 AI，按用户原文创建人物并发布初始当前灵魂。
 * @param input 用户确认的人物名称、完整灵魂和可选关系。
 * @returns 人物创建和导航全部完成时结束。
 */
async function createManualPersona(input: CreatePersonaInput): Promise<void> {
  if (manualCreateLoading.value) return
  manualCreateLoading.value = true
  manualCreateError.value = null
  try {
    const created = await $fetch<ApiResponse<PersonaDetails>>('/api/v1/personas', {
      method: 'POST',
      body: input,
    })
    notifySuccess(`人物“${created.data.persona.name}”已按输入原文创建。`, '人物创建完成')
    await navigateTo(`/personas/${created.data.persona.id}`)
  }
  catch (requestError: unknown) {
    manualCreateError.value = getApiErrorMessage(requestError, '人物创建失败')
    notifyError(manualCreateError.value, '人物创建失败')
  }
  finally {
    manualCreateLoading.value = false
  }
}

/**
 * 创建异步人物蒸馏运行并进入可恢复的工作区。
 * @param input 用户确认的人物名称、用途、可选世界和参考资料。
 * @returns 运行创建和导航全部完成时结束。
 */
async function createPersonaDistillation(input: CreatePersonaDistillationInput): Promise<void> {
  if (distillationCreateLoading.value) return
  distillationCreateLoading.value = true
  distillationCreateError.value = null
  try {
    const created = await $fetch<ApiResponse<PersonaDistillationRunView>>('/api/v1/persona-distillations', {
      method: 'POST',
      body: input,
    })
    notifySuccess(`人物“${created.data.requestedName}”的蒸馏运行已创建。`, '人物蒸馏已开始')
    await navigateTo(`/personas/distillations/${created.data.id}`)
  }
  catch (requestError: unknown) {
    distillationCreateError.value = getApiErrorMessage(requestError, '人物蒸馏创建失败')
    notifyError(distillationCreateError.value, '人物蒸馏创建失败')
  }
  finally {
    distillationCreateLoading.value = false
  }
}

/** @param personaIds 待修改人物 UUID。 @param isEnabled 统一状态。 @returns 请求是否成功。 */
async function updateSelectedPersonasStatus(personaIds: string[], isEnabled: boolean): Promise<boolean> {
  if (personaIds.length === 0 || batchStatusUpdating.value !== null) return false
  batchStatusUpdating.value = isEnabled
  try {
    await $fetch<ApiResponse<PersonaStatusUpdateResult>>('/api/v1/personas/status', {
      method: 'PATCH', body: { personaIds, isEnabled },
    })
    clearPersonaSelection()
    await refresh()
    notifySuccess(`已${isEnabled ? '启用' : '禁用'} ${personaIds.length} 个人物。`)
    return true
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, isEnabled ? '批量启用人物失败' : '批量禁用人物失败'))
    return false
  }
  finally {
    batchStatusUpdating.value = null
  }
}

/** @returns 有可启用人物时打开二次确认框。 */
function requestBatchEnable(): void {
  if (selectedDisabledPersonaIds.value.length > 0) batchEnableConfirmationOpen.value = true
}

/** @returns 用户确认后的批量启用和弹窗关闭结束时完成。 */
async function confirmBatchEnable(): Promise<void> {
  if (await updateSelectedPersonasStatus(selectedDisabledPersonaIds.value, true)) batchEnableConfirmationOpen.value = false
}

/** @returns 有可禁用人物时打开二次确认框。 */
function requestBatchDisable(): void {
  if (selectedEnabledPersonaIds.value.length > 0) batchDisableConfirmationOpen.value = true
}

/** @returns 用户确认后的批量禁用和弹窗关闭结束时完成。 */
async function confirmBatchDisable(): Promise<void> {
  if (await updateSelectedPersonasStatus(selectedEnabledPersonaIds.value, false)) batchDisableConfirmationOpen.value = false
}

/** @param page 新页码。 @param pageSize 新每页数量。 @returns 路由导航完成时结束。 */
async function updatePagination(page: number, pageSize: 5 | 10 | 20 | 50 | 100): Promise<void> {
  await navigateTo({ path: route.path, query: { ...route.query, page: String(page), pageSize: String(pageSize) } })
}

/** @param page 新页码。 @returns 路由导航完成时结束。 */
async function changePage(page: number): Promise<void> {
  await updatePagination(page, personaPage.value.pageSize)
}

/** @param pageSize 新每页数量。 @returns 回到第一页的路由导航完成时结束。 */
async function changePageSize(pageSize: number): Promise<void> {
  await updatePagination(1, readPageSize(pageSize))
}
</script>

<template>
  <div>
    <ContentPageHeader title="人物工作区" description="查看每个人物的启用状态、灵魂版本、所属世界和资料。">
      <ContentManualPersonaCreateModal v-model:open="showManualCreate" :worlds="worlds" :sources="sources"
        :loading="manualCreateLoading" :error-message="manualCreateError" @submit="createManualPersona">
        <UButton color="neutral" variant="soft" icon="i-lucide-pen-line">手动创建</UButton>
      </ContentManualPersonaCreateModal>
      <DistillationCreateModal v-model:open="showDistillationCreate" :worlds="worlds" :sources="sources"
        :loading="distillationCreateLoading" :error-message="distillationCreateError" @submit="createPersonaDistillation">
        <UButton icon="i-lucide-sparkles">AI 蒸馏创建</UButton>
      </DistillationCreateModal>
    </ContentPageHeader>

    <UAlert v-if="error" color="error" title="人物列表加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <section v-else class="content-section" aria-labelledby="persona-list-heading">
      <h2 id="persona-list-heading" class="visually-hidden">人物列表</h2>
      <div class="list-management-panel">
        <div class="list-management-controls">
          <form class="list-management-search" aria-label="筛选人物" @submit.prevent="applyPersonaFilter">
            <UInput v-model="personaFilterInput" class="list-management-search-input" icon="i-lucide-search"
              placeholder="输入人物名称" aria-label="人物列表搜索词" />
            <UButton type="submit" color="neutral" variant="soft">搜索人物</UButton>
            <UButton v-if="requestedPersonaFilter" type="button" color="neutral" variant="ghost"
              @click="clearPersonaFilter">清除筛选</UButton>
          </form>
          <div v-if="personas.length" class="list-management-batch">
            <span class="list-management-selection">{{ selectedPersonaIds.length > 0
              ? `已选择 ${selectedPersonaIds.length} 个人物`
              : '选择人物后可批量操作' }}</span>
            <div class="list-management-batch-actions">
              <UButton color="success" variant="soft" size="xs" icon="i-lucide-circle-check"
                :loading="batchStatusUpdating === true"
                :disabled="selectedDisabledPersonaIds.length === 0 || batchStatusUpdating !== null"
                @click="requestBatchEnable">批量启用</UButton>
              <UButton color="error" variant="soft" size="xs" icon="i-lucide-circle-off"
                :disabled="selectedEnabledPersonaIds.length === 0 || batchStatusUpdating !== null"
                @click="requestBatchDisable">批量禁用</UButton>
            </div>
          </div>
        </div>

        <template v-if="personas.length">
          <div class="content-table-wrap list-management-table">
            <table class="content-table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="选择当前页全部人物" :checked="allPagePersonasSelected"
                  :indeterminate="somePagePersonasSelected" :disabled="pagePersonaIds.length === 0"
                  @change="updateCurrentPageSelection"></th>
              <th>人物</th>
              <th>世界</th>
              <th>版本与资料</th>
              <th>启用状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="persona in personas" :key="persona.id">
              <td data-label="选择"><input type="checkbox" :aria-label="`选择人物：${persona.name}`"
                  :checked="selectedPersonaIds.includes(persona.id)"
                  @change="updatePersonaSelection(persona.id, $event)"></td>
              <td data-label="人物">
                <div class="flex min-w-0 items-center gap-3">
                  <NuxtLink :to="`/personas/${persona.id}`" data-persona-avatar-link
                    :aria-label="`查看人物头像：${persona.name}`" class="shrink-0">
                    <ContentPersonaAvatar :name="persona.name" :url="persona.avatarUrl" />
                  </NuxtLink>
                  <div class="min-w-0">
                    <NuxtLink :to="`/personas/${persona.id}`" data-persona-title-link
                      class="content-table-title hover:underline"><strong>{{ persona.name }}</strong></NuxtLink><span
                      class="content-table-description">{{ persona.currentSummary || '暂无灵魂提示词' }}</span>
                  </div>
                </div>
              </td>
              <td data-label="世界">
                <NuxtLink v-if="persona.worldId" :to="`/worlds/${persona.worldId}`"
                  class="content-table-title hover:underline">{{ persona.worldName }}</NuxtLink><span v-else
                  class="content-table-title">独立人物</span>
              </td>
              <td data-label="版本与资料"><span>{{ persona.versionCount }} 条修改记录</span><span
                  class="content-table-description">{{ persona.sourceCount }} 项参考资料</span></td>
              <td data-label="启用状态">
                <UBadge :color="persona.isEnabled ? 'success' : 'neutral'" variant="subtle">{{ persona.isEnabled ? '已启用'
                  : '已禁用' }}</UBadge>
              </td>
              <td data-label="操作">
                <UButton :to="`/personas/${persona.id}`" color="neutral" variant="ghost" size="xs"
                  icon="i-lucide-chevron-right" :aria-label="`查看与维护：${persona.name}`" />
              </td>
            </tr>
          </tbody>
            </table>
          </div>
          <div class="list-management-footer">
            <p class="m-0 text-sm text-muted">第 {{ personaPage.page }} / {{ personaPage.totalPages }} 页，共 {{ personaPage.total }} 项</p>
            <div class="list-management-pagination">
              <USelect :model-value="personaPage.pageSize" class="w-34" :items="pageSizeItems" aria-label="每页人物数量"
                @update:model-value="changePageSize" />
              <UPagination :page="personaPage.page" :total="personaPage.total" :items-per-page="personaPage.pageSize"
                show-edges @update:page="changePage" />
            </div>
          </div>
        </template>
        <div v-else class="content-empty-state list-management-empty">
          <div><strong>{{ requestedPersonaFilter ? '没有匹配的人物' : '还没有人物' }}</strong>
            <p class="mt-1 text-sm text-muted">{{ requestedPersonaFilter ? '请调整人物名称关键词后重试。' : '创建人物时可以按需选择世界和参考资料。' }}</p>
            <UButton v-if="requestedPersonaFilter" class="mt-4" color="neutral" variant="soft"
              @click="clearPersonaFilter">清除筛选</UButton>
            <div v-else class="mt-4 flex flex-wrap justify-center gap-2">
              <UButton color="neutral" variant="soft" icon="i-lucide-pen-line" @click="openManualCreateModal">手动创建第一个人物</UButton>
              <UButton icon="i-lucide-sparkles" @click="openDistillationCreateModal">AI 蒸馏创建第一个人物</UButton>
            </div>
          </div>
        </div>
      </div>
    </section>

    <UModal v-model:open="batchEnableConfirmationOpen" title="确认批量启用人物" description="启用后，这些人物可以重新用于创建新任务。">
      <template #body>
        <p class="text-sm text-muted">确定启用当前页已选择的 {{ selectedDisabledPersonaIds.length }} 个禁用人物吗？</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="batchStatusUpdating !== null"
            @click="batchEnableConfirmationOpen = false">取消</UButton>
          <UButton color="success" :loading="batchStatusUpdating === true" @click="confirmBatchEnable">确认启用</UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="batchDisableConfirmationOpen" title="确认批量禁用人物" description="人物设定、资料关系和历史记录仍会保留。">
      <template #body>
        <p class="text-sm text-muted">确定禁用当前页已选择的 {{ selectedEnabledPersonaIds.length }} 个启用人物吗？禁用后不能再用这些人物创建新任务。</p>
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
