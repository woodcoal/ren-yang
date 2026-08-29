<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import type { GrowthRecordView } from '#shared/types/learning'

interface SourceOption {
  /** 来源 UUID。 */
  id: string
  /** 来源展示名称。 */
  label: string
}

defineProps<{
  /** 当前成长及全部审核状态。 */
  items: GrowthRecordView[]
  /** 人工成长可引用的原始资料。 */
  sources: SourceOption[]
  /** 页面级动作是否正在执行。 */
  loading: boolean
  /** 世界或人物的通俗对象名称。 */
  subjectLabel: string
}>()

const emit = defineEmits<{
  /** 创建仍需确认的人工成长候选。 */
  create: [input: { content: string, scope: string, importance: number, sourceIds: string[] }]
  /** 批量审核成长状态。 */
  status: [input: { ids: string[], status: 'active' | 'archived' | 'rejected' }]
}>()

const form = reactive({ content: '', scope: '所有新任务', importance: 3, sourceIds: [] as string[] })
const selectedIds = shallowRef<string[]>([])
const selectedCount = computed(() => selectedIds.value.length)

/** @returns 无返回值。 */
function createGrowth(): void {
  const content = form.content.trim()
  const scope = form.scope.trim()
  if (!content || !scope) return
  emit('create', { content, scope, importance: form.importance, sourceIds: [...form.sourceIds] })
  form.content = ''
  form.sourceIds = []
}

/** @param id 成长 UUID。 @param selected 新选择状态。 @returns 无返回值。 */
function toggleSelection(id: string, selected: boolean): void {
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter(item => item !== id)
}

/** @param status 目标审核状态。 @returns 无返回值。 */
function submitStatus(status: 'active' | 'archived' | 'rejected'): void {
  if (!selectedIds.value.length) return
  emit('status', { ids: selectedIds.value, status })
  selectedIds.value = []
}

/** @param status 生命周期状态。 @returns 通俗中文状态。 */
function statusLabel(status: GrowthRecordView['status']): string {
  return { candidate: '待确认', active: '已生效', superseded: '已取代', archived: '已停用', rejected: '已拒绝' }[status]
}
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="font-semibold text-highlighted">{{ subjectLabel }}成长记录</h2>
        <p class="mt-1 text-sm text-muted">人工添加和 AI 分析都先形成候选，只有确认后才会进入新任务。</p>
      </div>
    </template>

    <form class="learning-create-form" @submit.prevent="createGrowth">
      <UFormField label="学会了什么"><UTextarea v-model="form.content" class="w-full" :rows="3" maxlength="20000" /></UFormField>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="适用范围"><UInput v-model="form.scope" class="w-full" maxlength="500" /></UFormField>
        <UFormField label="重要程度（1-5）"><UInput v-model.number="form.importance" class="w-full" type="number" min="1" max="5" /></UFormField>
      </div>
      <UFormField v-if="sources.length" label="依据资料（可多选）">
        <select v-model="form.sourceIds" class="native-control" multiple size="4">
          <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.label }}</option>
        </select>
      </UFormField>
      <UButton type="submit" :loading="loading" :disabled="!form.content.trim() || !form.scope.trim()">创建待确认成长</UButton>
    </form>

    <div v-if="selectedCount" class="learning-batch-bar mt-5">
      <span>已选 {{ selectedCount }} 项</span>
      <div class="flex flex-wrap gap-2">
        <UButton size="xs" :loading="loading" @click="submitStatus('active')">确认生效/恢复</UButton>
        <UButton size="xs" color="neutral" variant="soft" :loading="loading" @click="submitStatus('archived')">停用</UButton>
        <UButton size="xs" color="error" variant="soft" :loading="loading" @click="submitStatus('rejected')">拒绝候选</UButton>
      </div>
    </div>

    <div v-if="items.length" class="learning-list mt-5">
      <label v-for="item in items" :key="item.id" class="learning-row">
        <input type="checkbox" :checked="selectedIds.includes(item.id)" @change="toggleSelection(item.id, ($event.target as HTMLInputElement).checked)">
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-center gap-2">
            <UBadge :color="item.status === 'active' ? 'success' : 'neutral'" variant="soft">{{ statusLabel(item.status) }}</UBadge>
            <span class="text-xs text-muted">修订 {{ item.revisionNo }} · 重要程度 {{ item.importance }} · {{ item.evidenceCount }} 项依据</span>
          </span>
          <strong class="mt-2 block whitespace-pre-wrap text-sm text-highlighted">{{ item.content }}</strong>
          <span class="mt-1 block text-sm text-muted">适用范围：{{ item.scope }}</span>
          <span v-if="item.conflictSummary" class="mt-1 block text-sm text-warning">冲突：{{ item.conflictSummary }}</span>
        </span>
      </label>
    </div>
    <p v-else class="mt-5 text-sm text-muted">还没有成长记录。</p>
  </UCard>
</template>
