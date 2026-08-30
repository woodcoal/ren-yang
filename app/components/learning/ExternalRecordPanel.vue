<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { SaveExternalRecordInput } from '#shared/schemas/learning'
import type { PersonaExternalRecordView } from '#shared/types/learning'

const props = defineProps<{
  /** 当前人物人工补充的第三方经历记录。 */
  items: PersonaExternalRecordView[]
  /** 页面级动作是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 新建一条第三方经历记录。 */
  create: [input: SaveExternalRecordInput]
  /** 修改一条第三方经历记录。 */
  update: [input: SaveExternalRecordInput & { id: string }]
  /** 批量改变第三方记录是否参加记忆提炼。 */
  status: [input: { ids: string[], isEnabled: boolean }]
  /** 批量永久删除第三方记录。 */
  delete: [input: { ids: string[] }]
}>()

const pageSizeOptions = [5, 10, 20, 50].map(value => ({ label: `${value} 项/页`, value }))
const page = shallowRef(1)
const pageSize = shallowRef(10)
const selectedIds = shallowRef<string[]>([])
const editorOpen = shallowRef(false)
const editingRecord = shallowRef<PersonaExternalRecordView | null>(null)
const deleteOpen = shallowRef(false)
const totalPages = computed(() => Math.max(1, Math.ceil(props.items.length / pageSize.value)))
const pagedItems = computed(() => props.items.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const currentPageSelected = computed(() => pagedItems.value.length > 0
  && pagedItems.value.every(item => selectedIds.value.includes(item.id)))

/**
 * 打开空白第三方记录弹窗。
 * @returns 弹窗打开时结束。
 */
function openCreate(): void {
  editingRecord.value = null
  editorOpen.value = true
}

/**
 * 打开指定第三方记录的修改弹窗。
 * @param item 当前第三方经历记录。
 * @returns 弹窗打开时结束。
 */
function openEdit(item: PersonaExternalRecordView): void {
  editingRecord.value = item
  editorOpen.value = true
}

/**
 * 提交新建或修改命令，并关闭编辑弹窗。
 * @param input 完整第三方经历记录表单。
 * @returns 对应事件发出时结束。
 */
function submitRecord(input: SaveExternalRecordInput): void {
  if (editingRecord.value) emit('update', { id: editingRecord.value.id, ...input })
  else emit('create', input)
  editorOpen.value = false
}

/**
 * 修改一条记录的跨页选择状态。
 * @param id 第三方记录 UUID。
 * @param selected 是否选中。
 * @returns 选择集合更新时结束。
 */
function toggleSelection(id: string, selected: boolean): void {
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter(item => item !== id)
}

/**
 * 全选或清空当前页记录，不影响其他页选择。
 * @param selected true 表示全选本页。
 * @returns 选择集合更新时结束。
 */
function toggleCurrentPage(selected: boolean): void {
  const currentIds = new Set(pagedItems.value.map(item => item.id))
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, ...currentIds])]
    : selectedIds.value.filter(id => !currentIds.has(id))
}

/**
 * 提交所选记录的统一启用状态。
 * @param isEnabled 是否参加下一次人物记忆提炼。
 * @returns 状态事件发出且选择清空时结束。
 */
function submitStatus(isEnabled: boolean): void {
  if (!selectedIds.value.length) return
  emit('status', { ids: [...selectedIds.value], isEnabled })
  selectedIds.value = []
}

/**
 * 打开所选第三方记录的永久删除确认框。
 * @returns 存在选择时打开确认框。
 */
function requestDelete(): void {
  if (selectedIds.value.length) deleteOpen.value = true
}

/**
 * 确认永久删除所选第三方记录。
 * @returns 删除事件发出、选择清空且确认框关闭时结束。
 */
function confirmDelete(): void {
  emit('delete', { ids: [...selectedIds.value] })
  selectedIds.value = []
  deleteOpen.value = false
}

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
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold text-highlighted">第三方记录素材池</h2>
          <p class="mt-1 text-sm text-muted">手工记录人物在系统外做过的事情；已启用记录会与历史任务一起提炼记忆。</p>
        </div>
        <UButton icon="i-lucide-plus" :disabled="loading" data-external-record-add @click="openCreate">添加记录</UButton>
      </div>
    </template>

    <div v-if="selectedIds.length" class="learning-batch-bar mb-4">
      <span>已选 {{ selectedIds.length }} 项</span>
      <div class="flex flex-wrap gap-2">
        <UButton size="xs" :loading="loading" @click="submitStatus(true)">批量启用</UButton>
        <UButton size="xs" color="neutral" variant="soft" :loading="loading" @click="submitStatus(false)">批量禁用</UButton>
        <UButton size="xs" color="error" variant="soft" :loading="loading" data-external-record-delete @click="requestDelete">批量删除</UButton>
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
          <USelect v-model="pageSize" :items="pageSizeOptions" size="xs" class="w-28" aria-label="每页第三方记录数量" />
        </div>
      </div>

      <div class="learning-list">
        <article v-for="item in pagedItems" :key="item.id" class="learning-row">
          <input
            data-external-record-checkbox
            type="checkbox"
            :checked="selectedIds.includes(item.id)"
            :disabled="loading"
            :aria-label="`选择第三方记录：${item.occurredOn}`"
            @change="toggleSelection(item.id, ($event.target as HTMLInputElement).checked)">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <strong class="text-sm text-highlighted">{{ item.occurredOn }}</strong>
              <UBadge color="neutral" variant="soft">第三方记录</UBadge>
              <UBadge :color="item.isEnabled ? 'success' : 'neutral'" variant="soft">{{ item.isEnabled ? '参加提炼' : '不参加提炼' }}</UBadge>
            </div>
            <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{{ item.content }}</p>
            <div v-if="item.references.length" class="mt-2 space-y-1 text-xs text-muted">
              <p v-for="(reference, index) in item.references" :key="`${reference.name}-${index}`">{{ reference.name }}：{{ reference.address }}</p>
            </div>
          </div>
          <div class="flex shrink-0 flex-col gap-2">
            <UFormField label="评分" class="w-20">
              <UInput :model-value="item.importance" type="number" min="1" max="5" disabled aria-label="第三方记录评分" />
            </UFormField>
            <UButton size="xs" color="neutral" variant="soft" :disabled="loading" data-external-record-edit @click="openEdit(item)">修改</UButton>
          </div>
        </article>
      </div>

      <div v-if="items.length > pageSize" class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
        <span class="text-xs text-muted">第 {{ page }} / {{ totalPages }} 页</span>
        <UPagination v-model:page="page" :total="items.length" :items-per-page="pageSize" size="sm" :disabled="loading" />
      </div>
    </template>
    <p v-else class="text-sm text-muted">还没有第三方记录。可以手工补充人物在系统外做过的事情。</p>

    <LearningExternalRecordEditorModal
      v-model:open="editorOpen"
      :initial-value="editingRecord"
      :loading="loading"
      @submit="submitRecord"
    />
    <UModal v-model:open="deleteOpen" title="确认永久删除第三方记录" description="删除后不会改变已经发布的记忆提示词。">
      <template #body><p class="text-sm text-muted">确定永久删除选中的 {{ selectedIds.length }} 条第三方记录吗？</p></template>
      <template #footer><div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :disabled="loading" @click="deleteOpen = false">取消</UButton>
        <UButton color="error" :loading="loading" @click="confirmDelete">确认永久删除</UButton>
      </div></template>
    </UModal>
  </UCard>
</template>
