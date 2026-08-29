<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import type { PersonaFeedbackSourceView } from '#shared/types/learning'

defineProps<{
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

const form = reactive({ title: '', content: '' })
const selectedIds = shallowRef<string[]>([])
const selectedCount = computed(() => selectedIds.value.length)

/** @returns 无返回值。 */
function createSource(): void {
  const title = form.title.trim()
  const content = form.content.trim()
  if (!title || !content) return
  emit('create', { title, content, sourceType: 'manual' })
  form.title = ''
  form.content = ''
}

/** @param id 反馈资料 UUID。 @param selected 新选择状态。 @returns 无返回值。 */
function toggleSelection(id: string, selected: boolean): void {
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter(item => item !== id)
}

/** @param isEnabled 是否启用。 @returns 无返回值。 */
function submitStatus(isEnabled: boolean): void {
  if (!selectedIds.value.length) return
  emit('status', { ids: selectedIds.value, isEnabled })
  selectedIds.value = []
}

/** @returns 无返回值。 */
function deleteSelected(): void {
  if (!selectedIds.value.length) return
  emit('delete', { ids: selectedIds.value })
  selectedIds.value = []
}
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="font-semibold text-highlighted">人物反馈资料</h2>
        <p class="mt-1 text-sm text-muted">只有这里明确加入且启用的内容，才会参加人物成长分析。</p>
      </div>
    </template>

    <form class="learning-create-form" @submit.prevent="createSource">
      <UFormField label="反馈标题"><UInput v-model="form.title" class="w-full" maxlength="200" /></UFormField>
      <UFormField label="反馈内容"><UTextarea v-model="form.content" class="w-full" :rows="4" maxlength="200000" /></UFormField>
      <UButton type="submit" :loading="loading" :disabled="!form.title.trim() || !form.content.trim()">加入反馈资料</UButton>
    </form>

    <div v-if="selectedCount" class="learning-batch-bar mt-5">
      <span>已选 {{ selectedCount }} 项</span>
      <div class="flex flex-wrap gap-2">
        <UButton size="xs" :loading="loading" @click="submitStatus(true)">启用</UButton>
        <UButton size="xs" color="neutral" variant="soft" :loading="loading" @click="submitStatus(false)">禁用</UButton>
        <UButton size="xs" color="error" variant="soft" :loading="loading" @click="deleteSelected">删除</UButton>
      </div>
    </div>

    <div v-if="items.length" class="learning-list mt-5">
      <label v-for="item in items" :key="item.id" class="learning-row">
        <input type="checkbox" :checked="selectedIds.includes(item.id)" @change="toggleSelection(item.id, ($event.target as HTMLInputElement).checked)">
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-center gap-2">
            <strong class="text-sm text-highlighted">{{ item.title }}</strong>
            <UBadge :color="item.isEnabled ? 'success' : 'neutral'" variant="soft">{{ item.isEnabled ? '已启用' : '已禁用' }}</UBadge>
          </span>
          <span class="mt-1 block whitespace-pre-wrap text-sm text-muted">{{ item.content }}</span>
        </span>
      </label>
    </div>
    <p v-else class="mt-5 text-sm text-muted">还没有反馈资料。</p>
  </UCard>
</template>
