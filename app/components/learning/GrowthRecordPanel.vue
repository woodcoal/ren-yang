<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { GrowthRecordView } from '#shared/types/learning'
import type { GrowthEditorSubmission, GrowthImportSubmission, GrowthSourceOption } from './growthModels'
import GrowthRecordEditorModal from './GrowthRecordEditorModal.vue'
import GrowthRecordList from './GrowthRecordList.vue'
import GrowthSourceImportModal from './GrowthSourceImportModal.vue'

const props = defineProps<{
  /** 当前成长及全部审核状态。 */
  items: GrowthRecordView[]
  /** 可直接批量导入的当前原始资料。 */
  sources: GrowthSourceOption[]
  /** 页面级动作是否正在执行。 */
  loading: boolean
  /** 世界或人物的通俗对象名称。 */
  subjectLabel: string
}>()

const emit = defineEmits<{
  /** 按逐条评分批量导入资料。 */
  importSources: [input: GrowthImportSubmission]
  /** 修改成长并建立新的待确认修订。 */
  update: [input: Required<GrowthEditorSubmission>]
  /** 批量启用、禁用或拒绝成长。 */
  status: [input: { ids: string[], status: 'active' | 'archived' | 'rejected' }]
  /** 批量永久删除成长。 */
  delete: [input: { ids: string[] }]
}>()

const pageSizeOptions = [5, 10, 20, 50].map(value => ({ label: `${value} 项/页`, value }))
const page = shallowRef(1)
const pageSize = shallowRef(10)
const selectedIds = shallowRef<string[]>([])
const editorOpen = shallowRef(false)
const importOpen = shallowRef(false)
const deleteConfirmationOpen = shallowRef(false)
const editingItem = shallowRef<GrowthRecordView | null>(null)
const selectedCount = computed(() => selectedIds.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(props.items.length / pageSize.value)))
const pagedItems = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return props.items.slice(start, start + pageSize.value)
})
const currentPageSelected = computed(() => pagedItems.value.length > 0
  && pagedItems.value.every(item => selectedIds.value.includes(item.id)))
const selectedItems = computed(() => {
  const selectedSet = new Set(selectedIds.value)
  return props.items.filter(item => selectedSet.has(item.id))
})
const canActivateSelection = computed(() => selectedItems.value.every(item => ['candidate', 'active', 'archived'].includes(item.status)))
const canArchiveSelection = computed(() => selectedItems.value.every(item => ['active', 'archived'].includes(item.status)))
const canRejectSelection = computed(() => selectedItems.value.every(item => ['candidate', 'rejected'].includes(item.status)))

/**
 * 打开指定成长当前修订的修改弹窗。
 * @param item 当前列表中的成长修订。
 * @returns 编辑目标保存且弹窗打开后结束，无业务返回值。
 */
function openEdit(item: GrowthRecordView): void {
  editingItem.value = item
  editorOpen.value = true
}

/**
 * 转发成长新修订提交事件。
 * @param input 弹窗提交的成长 UUID、正文和重要程度。
 * @returns 页面级修改事件发出后结束，无业务返回值。
 */
function submitEditor(input: GrowthEditorSubmission): void {
  emit('update', input)
}

/**
 * 转发资料批量导入命令。
 * @param input 逐条资料评分。
 * @returns 页面级导入事件发出后结束，无业务返回值。
 */
function submitImport(input: GrowthImportSubmission): void {
  emit('importSources', input)
}

/**
 * 修改单条成长的跨页选择状态。
 * @param id 成长 UUID。
 * @param selected 是否选中。
 * @returns 选择集合更新完成后结束，无业务返回值。
 */
function toggleSelection(id: string, selected: boolean): void {
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter(item => item !== id)
}

/**
 * 全选或清空当前页成长，不影响其他页已经选择的条目。
 * @param selected true 表示全选本页，false 表示清空本页。
 * @returns 跨页选择集合更新完成后结束，无业务返回值。
 */
function toggleCurrentPage(selected: boolean): void {
  const currentIds = new Set(pagedItems.value.map(item => item.id))
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, ...currentIds])]
    : selectedIds.value.filter(id => !currentIds.has(id))
}

/**
 * 提交所选成长的统一目标状态并清空选择。
 * @param status 启用、禁用或拒绝对应的生命周期状态。
 * @returns 批量状态事件发出后结束，无业务返回值。
 */
function submitStatus(status: 'active' | 'archived' | 'rejected'): void {
  if (!selectedIds.value.length) return
  emit('status', { ids: [...selectedIds.value], status })
  selectedIds.value = []
}

/**
 * 打开批量永久删除确认弹窗。
 * @returns 有选择时打开确认弹窗，无业务返回值。
 */
function requestDelete(): void {
  if (selectedIds.value.length) deleteConfirmationOpen.value = true
}

/**
 * 确认永久删除当前跨页选择的全部成长。
 * @returns 删除事件发出、选择清空且确认弹窗关闭后结束。
 */
function confirmDelete(): void {
  if (!selectedIds.value.length) return
  emit('delete', { ids: [...selectedIds.value] })
  selectedIds.value = []
  deleteConfirmationOpen.value = false
}

// 服务端刷新列表后清理已不存在的选择，并把越界页码收拢到最后一页。
watch(() => props.items.map(item => item.id), (ids) => {
  const availableIds = new Set(ids)
  selectedIds.value = selectedIds.value.filter(id => availableIds.has(id))
  page.value = Math.min(page.value, totalPages.value)
}, { immediate: true })
watch(pageSize, () => {
  page.value = 1
})
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="font-semibold text-highlighted">{{ subjectLabel }}成长记录</h2>
          <p class="mt-1 text-sm text-muted">资料导入先形成候选，只有确认后才会进入新任务。</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton data-growth-import-button color="neutral" variant="soft" icon="i-lucide-import" @click="importOpen = true">从资料导入</UButton>
        </div>
      </div>
    </template>

    <div v-if="selectedCount" class="learning-batch-bar mb-4">
      <span>已选 {{ selectedCount }} 项</span>
      <div class="flex flex-wrap gap-2">
        <UButton size="xs" :loading="loading" :disabled="!canActivateSelection" @click="submitStatus('active')">批量启用</UButton>
        <UButton size="xs" color="neutral" variant="soft" :loading="loading" :disabled="!canArchiveSelection" @click="submitStatus('archived')">批量禁用</UButton>
        <UButton size="xs" color="warning" variant="soft" :loading="loading" :disabled="!canRejectSelection" @click="submitStatus('rejected')">拒绝候选</UButton>
        <UButton data-growth-delete-button size="xs" color="error" variant="soft" :disabled="loading" @click="requestDelete">批量删除</UButton>
      </div>
    </div>

    <template v-if="items.length">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <label class="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" :checked="currentPageSelected" :disabled="loading" @change="toggleCurrentPage(($event.target as HTMLInputElement).checked)">
          全选本页
        </label>
        <div class="flex items-center gap-3 text-xs text-muted">
          <span>共 {{ items.length }} 项</span>
          <USelect v-model="pageSize" :items="pageSizeOptions" size="xs" class="w-28" aria-label="每页成长数量" />
        </div>
      </div>

      <GrowthRecordList :items="pagedItems" :selected-ids="selectedIds" :loading="loading" @toggle="toggleSelection" @edit="openEdit" />

      <div v-if="items.length > pageSize" class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
        <span class="text-xs text-muted">第 {{ page }} / {{ totalPages }} 页</span>
        <UPagination v-model:page="page" :total="items.length" :items-per-page="pageSize" size="sm" :disabled="loading" />
      </div>
    </template>
    <p v-else class="text-sm text-muted">还没有成长记录。可以从当前对象已有资料批量导入。</p>
  </UCard>

  <GrowthRecordEditorModal v-if="editingItem" v-model:open="editorOpen" :item="editingItem" :loading="loading" :subject-label="subjectLabel" @save="submitEditor" />
  <GrowthSourceImportModal v-model:open="importOpen" :sources="sources" :loading="loading" :subject-label="subjectLabel" @import-sources="submitImport" />

  <UModal
    v-model:open="deleteConfirmationOpen"
    :title="`确认删除 ${selectedCount} 项${subjectLabel}成长`"
    description="删除会永久移除所选成长的全部修订和证据关系，历史运行快照不受影响。"
    :dismissible="!loading"
    :close="!loading"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :disabled="loading" @click="deleteConfirmationOpen = false">取消</UButton>
        <UButton color="error" :loading="loading" @click="confirmDelete">确认永久删除</UButton>
      </div>
    </template>
  </UModal>
</template>
