<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { GrowthLibrarySourceView, GrowthMaterialView } from '#shared/types/learning'
import type { GrowthImportSubmission, GrowthMaterialEditorSubmission } from './growthModels'
import GrowthMaterialEditorModal from './GrowthMaterialEditorModal.vue'
import GrowthMaterialImportModal from './GrowthMaterialImportModal.vue'

const props = defineProps<{
  /** 当前成长素材池。 */
  items: GrowthMaterialView[]
  /** 当前对象资料库中可选择的资料。 */
  sources: GrowthLibrarySourceView[]
  /** 页面级动作是否正在执行。 */
  loading: boolean
  /** 世界或人物的通俗对象名称。 */
  subjectLabel: string
}>()

const emit = defineEmits<{
  /** 按逐条评分批量导入资料。 */
  importSources: [input: GrowthImportSubmission]
  /** 手工添加一份成长素材。 */
  create: [input: Omit<GrowthMaterialEditorSubmission, 'id'>]
  /** 修改一份成长素材。 */
  update: [input: Required<GrowthMaterialEditorSubmission>]
  /** 批量启用或禁用成长素材。 */
  status: [input: { ids: string[], isEnabled: boolean }]
  /** 批量永久删除成长素材。 */
  delete: [input: { ids: string[] }]
}>()

const pageSizeOptions = [5, 10, 20, 50].map(value => ({ label: `${value} 项/页`, value }))
const page = shallowRef(1)
const pageSize = shallowRef(10)
const selectedIds = shallowRef<string[]>([])
const importOpen = shallowRef(false)
const editorOpen = shallowRef(false)
const deleteConfirmationOpen = shallowRef(false)
const editingItem = shallowRef<GrowthMaterialView | null>(null)
const totalPages = computed(() => Math.max(1, Math.ceil(props.items.length / pageSize.value)))
const pagedItems = computed(() => props.items.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const currentPageSelected = computed(() => pagedItems.value.length > 0
  && pagedItems.value.every(item => selectedIds.value.includes(item.id)))

/**
 * 打开手工添加成长素材弹窗。
 * @returns 新增模式弹窗打开时结束。
 */
function openCreate(): void {
  editingItem.value = null
  editorOpen.value = true
}

/**
 * 打开指定成长素材的修改弹窗。
 * @param item 当前素材快照。
 * @returns 编辑模式弹窗打开时结束。
 */
function openEdit(item: GrowthMaterialView): void {
  editingItem.value = item
  editorOpen.value = true
}

/**
 * 根据弹窗模式转发新增或修改命令。
 * @param input 素材标题、全文、评分和可选 UUID。
 * @returns 对应页面事件发出后结束。
 */
function submitEditor(input: GrowthMaterialEditorSubmission): void {
  if (input.id) emit('update', input as Required<GrowthMaterialEditorSubmission>)
  else emit('create', { title: input.title, content: input.content, importance: input.importance })
}

/**
 * 修改单条素材的跨页选择状态。
 * @param id 素材 UUID。
 * @param selected 是否选中。
 * @returns 选择集合更新完成时结束。
 */
function toggleSelection(id: string, selected: boolean): void {
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter(item => item !== id)
}

/**
 * 全选或清空当前页素材，不影响其他页选择。
 * @param selected true 表示全选本页，false 表示清空本页。
 * @returns 跨页选择集合更新完成时结束。
 */
function toggleCurrentPage(selected: boolean): void {
  const currentIds = new Set(pagedItems.value.map(item => item.id))
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, ...currentIds])]
    : selectedIds.value.filter(id => !currentIds.has(id))
}

/**
 * 提交当前跨页选择的统一启用状态。
 * @param isEnabled 是否参加下一次 AI 成长提炼。
 * @returns 状态事件发出且选择清空后结束。
 */
function submitStatus(isEnabled: boolean): void {
  if (!selectedIds.value.length) return
  emit('status', { ids: [...selectedIds.value], isEnabled })
  selectedIds.value = []
}

/**
 * 确认永久删除当前跨页选择的成长素材快照。
 * @returns 删除事件发出、选择清空且确认框关闭后结束。
 */
function confirmDelete(): void {
  if (!selectedIds.value.length) return
  emit('delete', { ids: [...selectedIds.value] })
  selectedIds.value = []
  deleteConfirmationOpen.value = false
}

/**
 * 返回成长素材来源的通俗名称。
 * @param sourceType 素材来源类型。
 * @returns 对应中文标签。
 */
function sourceTypeLabel(sourceType: GrowthMaterialView['sourceType']): string {
  return { source_material: '资料库快照', manual: '手工文档', legacy: '旧数据迁移' }[sourceType]
}

/**
 * 返回来源资料同步状态的通俗名称。
 * @param sourceState 素材来源同步状态。
 * @returns 对应中文标签。
 */
function sourceStateLabel(sourceState: GrowthMaterialView['sourceState']): string {
  return { current: '来源未变化', changed: '来源已变化', missing: '来源已移除', not_applicable: '独立素材' }[sourceState]
}

// 服务端刷新后清理已不存在的跨页选择，并收拢越界页码。
watch(() => props.items.map(item => item.id), (ids) => {
  const available = new Set(ids)
  selectedIds.value = selectedIds.value.filter(id => available.has(id))
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
          <h2 class="font-semibold text-highlighted">{{ subjectLabel }}成长素材池</h2>
          <p class="mt-1 text-sm text-muted">素材只供 AI 综合提炼；评分越高，提炼时权重越高。</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton data-growth-import-button color="neutral" variant="soft" icon="i-lucide-import" @click="importOpen = true">从资料库选择</UButton>
          <UButton data-growth-add-button icon="i-lucide-plus" @click="openCreate">手工添加文档</UButton>
        </div>
      </div>
    </template>

    <div v-if="selectedIds.length" class="learning-batch-bar mb-4">
      <span>已选 {{ selectedIds.length }} 项</span>
      <div class="flex flex-wrap gap-2">
        <UButton size="xs" :loading="loading" @click="submitStatus(true)">批量启用</UButton>
        <UButton size="xs" color="neutral" variant="soft" :loading="loading" @click="submitStatus(false)">批量禁用</UButton>
        <UButton data-growth-delete-button size="xs" color="error" variant="soft" :disabled="loading" @click="deleteConfirmationOpen = true">批量删除</UButton>
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
          <USelect v-model="pageSize" :items="pageSizeOptions" size="xs" class="w-28" aria-label="每页素材数量" />
        </div>
      </div>

      <div class="learning-list">
        <article v-for="item in pagedItems" :key="item.id" class="learning-row">
          <input
            data-growth-row-checkbox
            type="checkbox"
            :checked="selectedIds.includes(item.id)"
            :disabled="loading"
            :aria-label="`选择成长素材：${item.title}`"
            @change="toggleSelection(item.id, ($event.target as HTMLInputElement).checked)"
          >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <strong class="text-sm text-highlighted">{{ item.title }}</strong>
              <UBadge :color="item.isEnabled ? 'success' : 'neutral'" variant="soft">{{ item.isEnabled ? '参加提炼' : '不参加提炼' }}</UBadge>
              <UBadge color="neutral" variant="soft">{{ sourceTypeLabel(item.sourceType) }}</UBadge>
              <UBadge v-if="item.sourceState !== 'not_applicable'" :color="item.sourceState === 'current' ? 'neutral' : 'warning'" variant="soft">{{ sourceStateLabel(item.sourceState) }}</UBadge>
              <span class="text-xs text-muted">评分 {{ item.importance }}</span>
            </div>
            <p class="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted">{{ item.content }}</p>
            <p v-if="item.sourceState === 'changed'" class="mt-2 text-xs text-warning">资料库原文已变化；如需采用新内容，请从资料库重新导入。</p>
            <p v-else-if="item.sourceState === 'missing'" class="mt-2 text-xs text-warning">来源资料已不在当前资料库；当前固定快照仍可继续用于提炼。</p>
          </div>
          <UButton data-growth-edit-button color="neutral" variant="ghost" size="xs" icon="i-lucide-pencil" :disabled="loading" @click="openEdit(item)">修改</UButton>
        </article>
      </div>

      <div v-if="items.length > pageSize" class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
        <span class="text-xs text-muted">第 {{ page }} / {{ totalPages }} 页</span>
        <UPagination v-model:page="page" :total="items.length" :items-per-page="pageSize" size="sm" :disabled="loading" />
      </div>
    </template>
    <p v-else class="text-sm text-muted">还没有成长素材。可从资料库选择，或手工添加一份独立文档。</p>
  </UCard>

  <GrowthMaterialImportModal
    v-model:open="importOpen"
    :sources="sources.map(source => ({ id: source.id, label: source.name, content: source.content, isEnabled: source.isEnabled, isImported: source.isImported }))"
    :loading="loading"
    :subject-label="subjectLabel"
    @import-sources="emit('importSources', $event)"
  />
  <GrowthMaterialEditorModal v-model:open="editorOpen" :item="editingItem" :loading="loading" :subject-label="subjectLabel" @save="submitEditor" />

  <UModal
    v-model:open="deleteConfirmationOpen"
    :title="`确认删除 ${selectedIds.length} 项${subjectLabel}成长素材`"
    description="删除只移除素材快照，不删除资料库原文，也不改变当前已发布成长提示词。"
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
