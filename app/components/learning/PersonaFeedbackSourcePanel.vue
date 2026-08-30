<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import type { PersonaFeedbackSourceView } from '#shared/types/learning'

const props = defineProps<{
  /** 当前人物反馈资料。 */
  items: PersonaFeedbackSourceView[]
  /** 页面级动作是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 创建人工反馈资料。 */
  create: [input: { title: string, content: string, sourceType: 'manual' }]
  /** 批量改变资料是否参加分析。 */
  status: [input: { ids: string[], isEnabled: boolean }]
  /** 批量永久删除反馈资料。 */
  delete: [input: { ids: string[] }]
}>()

const pageSize = 10
const form = reactive({ title: '', content: '' })
const page = shallowRef(1)
const createModalOpen = shallowRef(false)
const selectedIds = shallowRef<string[]>([])
const selectedCount = computed(() => selectedIds.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(props.items.length / pageSize)))
const pagedItems = computed(() => props.items.slice((page.value - 1) * pageSize, page.value * pageSize))
const currentPageSelected = computed(() => pagedItems.value.length > 0
  && pagedItems.value.every(item => selectedIds.value.includes(item.id)))

/**
 * 打开反馈资料添加弹窗并清空上一次输入。
 * @returns 空白表单显示完成后结束，无业务返回值。
 */
function openCreateModal(): void {
  form.title = ''
  form.content = ''
  createModalOpen.value = true
}

/**
 * 校验非空标题和正文后创建人物反馈资料。
 * @returns 创建事件发出且弹窗关闭后结束，无业务返回值。
 */
function createSource(): void {
  const title = form.title.trim()
  const content = form.content.trim()
  if (!title || !content) return
  emit('create', { title, content, sourceType: 'manual' })
  createModalOpen.value = false
}

/**
 * 修改单份反馈资料的跨页选择状态。
 * @param id 反馈资料 UUID。
 * @param selected 是否选中。
 * @returns 选择集合更新完成后结束，无业务返回值。
 */
function toggleSelection(id: string, selected: boolean): void {
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter(item => item !== id)
}

/**
 * 全选或清空当前页反馈资料，不影响其他页选择。
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
 * 批量修改所选反馈资料的分析启用状态。
 * @param isEnabled true 表示启用，false 表示禁用。
 * @returns 状态事件发出并清空选择后结束，无业务返回值。
 */
function submitStatus(isEnabled: boolean): void {
  if (!selectedIds.value.length) return
  emit('status', { ids: [...selectedIds.value], isEnabled })
  selectedIds.value = []
}

/**
 * 批量永久删除所选人物反馈资料。
 * @returns 删除事件发出并清空选择后结束，无业务返回值。
 */
function deleteSelected(): void {
  if (!selectedIds.value.length) return
  emit('delete', { ids: [...selectedIds.value] })
  selectedIds.value = []
}

// 服务端刷新后清理无效选择并把页码修正到现有范围。
watch(() => props.items.map(item => item.id), (ids) => {
  const availableIds = new Set(ids)
  selectedIds.value = selectedIds.value.filter(id => availableIds.has(id))
  page.value = Math.min(page.value, totalPages.value)
}, { immediate: true })
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="font-semibold text-highlighted">人物反馈资料</h2>
          <p class="mt-1 text-sm text-muted">只有这里明确加入且启用的内容，才会参加人物成长分析。</p>
        </div>
        <UButton data-feedback-source-add-button color="neutral" variant="soft" icon="i-lucide-plus" @click="openCreateModal">添加反馈资料</UButton>
      </div>
    </template>

    <div v-if="selectedCount" class="learning-batch-bar mb-4">
      <span>已选 {{ selectedCount }} 项</span>
      <div class="flex flex-wrap gap-2">
        <UButton size="xs" :loading="loading" @click="submitStatus(true)">启用</UButton>
        <UButton size="xs" color="neutral" variant="soft" :loading="loading" @click="submitStatus(false)">禁用</UButton>
        <UButton size="xs" color="error" variant="soft" :loading="loading" @click="deleteSelected">删除</UButton>
      </div>
    </div>

    <template v-if="items.length">
      <div class="mb-3 flex items-center justify-between gap-3 text-xs text-muted">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" :checked="currentPageSelected" :disabled="loading" @change="toggleCurrentPage(($event.target as HTMLInputElement).checked)">
          全选本页
        </label>
        <span>共 {{ items.length }} 项</span>
      </div>
      <div class="learning-list">
        <article v-for="item in pagedItems" :key="item.id" class="learning-row">
          <input type="checkbox" :checked="selectedIds.includes(item.id)" :disabled="loading" :aria-label="`选择反馈资料 ${item.title}`" @change="toggleSelection(item.id, ($event.target as HTMLInputElement).checked)">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <strong class="text-sm text-highlighted">{{ item.title }}</strong>
              <UBadge :color="item.isEnabled ? 'success' : 'neutral'" variant="soft">{{ item.isEnabled ? '已启用' : '已禁用' }}</UBadge>
            </div>
            <p class="mt-1 line-clamp-4 whitespace-pre-wrap text-sm text-muted">{{ item.content }}</p>
          </div>
        </article>
      </div>
      <div v-if="items.length > pageSize" class="mt-4 flex items-center justify-between gap-3 border-t border-default pt-4">
        <span class="text-xs text-muted">第 {{ page }} / {{ totalPages }} 页</span>
        <UPagination v-model:page="page" :total="items.length" :items-per-page="pageSize" size="sm" :disabled="loading" />
      </div>
    </template>
    <p v-else class="text-sm text-muted">还没有反馈资料。</p>
  </UCard>

  <UModal v-model:open="createModalOpen" title="添加人物反馈资料" description="添加后默认启用，可立即用于成长分析或直接导入成长。" :dismissible="!loading" :close="!loading">
    <template #body>
      <form data-feedback-source-form class="space-y-4" @submit.prevent="createSource">
        <UFormField label="反馈标题" required>
          <UInput v-model="form.title" class="w-full" maxlength="200" :disabled="loading" />
        </UFormField>
        <UFormField label="反馈内容" required>
          <UTextarea v-model="form.content" class="w-full" :rows="8" autoresize :maxrows="14" maxlength="200000" :disabled="loading" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="loading" @click="createModalOpen = false">取消</UButton>
          <UButton type="submit" :loading="loading" :disabled="!form.title.trim() || !form.content.trim()">加入反馈资料</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
