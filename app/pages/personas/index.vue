<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { QuickCreateSubjectInput } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaDetails, PersonaPageView, PersonaStatusUpdateResult, SoulSnapshot } from '#shared/types/content'
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
const personaPageQuery = computed(() => ({ page: requestedPage.value, pageSize: requestedPageSize.value }))
const { data, error, refresh } = await useFetch<ApiResponse<PersonaPageView>>('/api/v1/personas/page', { query: personaPageQuery })
const personaPage = computed<PersonaPageView>(() => data.value?.data ?? {
  items: [], total: 0, page: requestedPage.value, pageSize: requestedPageSize.value, totalPages: 1,
})
const personas = computed(() => personaPage.value.items)
const usablePersonaCount = computed(() => personas.value.filter(persona => persona.isEnabled).length)
const disabledPersonaCount = computed(() => personas.value.filter(persona => !persona.isEnabled).length)
const showCreate = shallowRef(false)
const createLoading = shallowRef(false)
const createErrorMessage = shallowRef<string | null>(null)
const actionErrorMessage = shallowRef<string | null>(null)
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

watch([requestedPage, requestedPageSize], clearPersonaSelection)

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

/** @returns 打开人物快速创建弹窗并清除上一次请求错误。 */
function openCreateModal(): void {
  createErrorMessage.value = null
  showCreate.value = true
}

/**
 * 按用户选择直接保存原文或先用 AI 整理，再创建人物当前灵魂并进入详情。
 * @param input 用户确认的人物名称、灵魂提示词和整理方式。
 * @returns 整理、创建和导航全部完成时结束。
 */
async function createPersona(input: QuickCreateSubjectInput): Promise<void> {
  createLoading.value = true
  createErrorMessage.value = null
  try {
    let snapshot: SoulSnapshot = { promptText: input.promptText }
    if (input.autoAnalyze) {
      const analyzed = await $fetch<ApiResponse<SoulSnapshot>>('/api/v1/soul/analyze', {
        method: 'POST', body: { subjectType: 'persona', promptText: input.promptText },
      })
      snapshot = analyzed.data
    }
    const created = await $fetch<ApiResponse<PersonaDetails>>('/api/v1/personas', {
      method: 'POST', body: {
        name: input.name, worldId: null, sourceIds: [], snapshot,
        changeSummary: input.autoAnalyze ? 'AI 整理初始人物灵魂' : '按原文建立初始人物灵魂',
      },
    })
    await navigateTo(`/personas/${created.data.persona.id}`)
  }
  catch (requestError: unknown) {
    createErrorMessage.value = getApiErrorMessage(requestError, '人物创建失败')
  }
  finally {
    createLoading.value = false
  }
}

/** @param personaIds 待修改人物 UUID。 @param isEnabled 统一状态。 @returns 请求是否成功。 */
async function updateSelectedPersonasStatus(personaIds: string[], isEnabled: boolean): Promise<boolean> {
  if (personaIds.length === 0 || batchStatusUpdating.value !== null) return false
  batchStatusUpdating.value = isEnabled
  actionErrorMessage.value = null
  try {
    await $fetch<ApiResponse<PersonaStatusUpdateResult>>('/api/v1/personas/status', {
      method: 'PATCH', body: { personaIds, isEnabled },
    })
    clearPersonaSelection()
    await refresh()
    return true
  }
  catch (requestError: unknown) {
    actionErrorMessage.value = getApiErrorMessage(requestError, isEnabled ? '批量启用人物失败' : '批量禁用人物失败')
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
      <ContentQuickCreateSubjectModal v-model:open="showCreate" subject-type="persona" :loading="createLoading"
        :error-message="createErrorMessage" @submit="createPersona">
        <UButton icon="i-lucide-plus">创建人物</UButton>
      </ContentQuickCreateSubjectModal>
    </ContentPageHeader>

    <div class="status-strip page-status-strip" aria-label="人物状态摘要">
      <div class="status-cell"><span class="status-kicker">全部人物</span><strong class="status-value">{{ personaPage.total }}</strong></div>
      <div class="status-cell"><span class="status-kicker">本页可创建任务</span><strong class="status-value">{{ usablePersonaCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">本页已禁用</span><strong class="status-value">{{ disabledPersonaCount }}</strong></div>
    </div>

    <UAlert v-if="actionErrorMessage" class="mb-5" color="error" title="操作失败" :description="actionErrorMessage" />
    <UAlert v-if="error" color="error" title="人物列表加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <section v-else-if="personas.length" class="content-section" aria-labelledby="persona-list-heading">
      <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">人物状态</p><h2 id="persona-list-heading">已建立的人物</h2><p>禁用只影响后续新任务，历史记录、人物设定和资料关系仍会保留。</p></div></div>
      <div class="content-toolbar !rounded-none !bg-transparent !border-0">
        <span v-if="selectedPersonaIds.length > 0" class="text-sm text-muted">已选择 {{ selectedPersonaIds.length }} 个人物</span><span v-else aria-hidden="true"></span>
        <div class="flex items-center justify-end gap-1">
          <UButton color="success" variant="ghost" size="xs" :loading="batchStatusUpdating === true"
            :disabled="selectedDisabledPersonaIds.length === 0 || batchStatusUpdating !== null" @click="requestBatchEnable">批量启用</UButton>
          <UButton color="error" variant="ghost" size="xs" :disabled="selectedEnabledPersonaIds.length === 0 || batchStatusUpdating !== null"
            @click="requestBatchDisable">批量禁用</UButton>
        </div>
      </div>
      <div class="content-table-wrap">
        <table class="content-table">
          <thead><tr><th><input type="checkbox" aria-label="选择当前页全部人物" :checked="allPagePersonasSelected"
            :indeterminate="somePagePersonasSelected" :disabled="pagePersonaIds.length === 0" @change="updateCurrentPageSelection"></th>
            <th>人物</th><th>世界</th><th>版本与资料</th><th>启用状态</th><th>操作</th></tr></thead>
          <tbody><tr v-for="persona in personas" :key="persona.id">
            <td data-label="选择"><input type="checkbox" :aria-label="`选择人物：${persona.name}`" :checked="selectedPersonaIds.includes(persona.id)" @change="updatePersonaSelection(persona.id, $event)"></td>
            <td data-label="人物"><div class="flex min-w-0 items-center gap-3">
              <ContentPersonaAvatar :name="persona.name" :url="persona.avatarUrl" />
              <div class="min-w-0"><strong class="content-table-title">{{ persona.name }}</strong><span class="content-table-description">{{ persona.currentSummary || '暂无灵魂提示词' }}</span></div>
            </div></td>
            <td data-label="世界"><span class="content-table-title">{{ persona.worldName || '独立人物' }}</span></td>
            <td data-label="版本与资料"><span>{{ persona.versionCount }} 条修改记录</span><span class="content-table-description">{{ persona.sourceCount }} 项参考资料</span></td>
            <td data-label="启用状态"><UBadge :color="persona.isEnabled ? 'success' : 'neutral'" variant="subtle">{{ persona.isEnabled ? '已启用' : '已禁用' }}</UBadge></td>
            <td data-label="操作"><UButton :to="`/personas/${persona.id}`" color="neutral" variant="ghost" size="xs"
              icon="i-lucide-chevron-right" :aria-label="`查看与维护：${persona.name}`" /></td>
          </tr></tbody>
        </table>
      </div>
      <div class="mt-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <p class="text-sm text-muted">第 {{ personaPage.page }} / {{ personaPage.totalPages }} 页，共 {{ personaPage.total }} 项</p>
        <div class="flex flex-wrap items-center gap-3">
          <USelect :model-value="personaPage.pageSize" class="w-34" :items="pageSizeItems" aria-label="每页人物数量" @update:model-value="changePageSize" />
          <UPagination :page="personaPage.page" :total="personaPage.total" :items-per-page="personaPage.pageSize" show-edges @update:page="changePage" />
        </div>
      </div>
    </section>
    <div v-else class="content-empty-state"><div><strong>还没有人物</strong><p class="mt-1 text-sm text-muted">创建人物时可以按需选择世界和参考资料。</p><UButton class="mt-4" @click="openCreateModal">创建第一个人物</UButton></div></div>

    <UModal v-model:open="batchEnableConfirmationOpen" title="确认批量启用人物" description="启用后，这些人物可以重新用于创建新任务。">
      <template #body><p class="text-sm text-muted">确定启用当前页已选择的 {{ selectedDisabledPersonaIds.length }} 个禁用人物吗？</p></template>
      <template #footer><div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :disabled="batchStatusUpdating !== null" @click="batchEnableConfirmationOpen = false">取消</UButton>
        <UButton color="success" :loading="batchStatusUpdating === true" @click="confirmBatchEnable">确认启用</UButton>
      </div></template>
    </UModal>

    <UModal v-model:open="batchDisableConfirmationOpen" title="确认批量禁用人物" description="人物设定、资料关系和历史记录仍会保留。">
      <template #body><p class="text-sm text-muted">确定禁用当前页已选择的 {{ selectedEnabledPersonaIds.length }} 个启用人物吗？禁用后不能再用这些人物创建新任务。</p></template>
      <template #footer><div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :disabled="batchStatusUpdating !== null" @click="batchDisableConfirmationOpen = false">取消</UButton>
        <UButton color="error" :loading="batchStatusUpdating === false" @click="confirmBatchDisable">确认禁用</UButton>
      </div></template>
    </UModal>
  </div>
</template>
