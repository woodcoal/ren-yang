<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { MemoryRecordView } from '#shared/types/learning'

defineProps<{
  /** 当前人物记忆及全部审核状态。 */
  items: MemoryRecordView[]
  /** 页面级动作是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 批量审核记忆状态。 */
  status: [input: { ids: string[], status: 'active' | 'archived' | 'rejected' }]
  /** 把一条记忆显式转为人物成长反馈资料。 */
  convert: [memoryId: string]
}>()

const selectedIds = shallowRef<string[]>([])
const selectedCount = computed(() => selectedIds.value.length)

/** @param id 记忆 UUID。 @param selected 新选择状态。 @returns 无返回值。 */
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
function statusLabel(status: MemoryRecordView['status']): string {
  return { candidate: '待确认', active: '已生效', superseded: '已取代', archived: '已停用', rejected: '已拒绝' }[status]
}
</script>

<template>
  <UCard>
    <template #header><div><h2 class="font-semibold text-highlighted">人物记忆</h2><p class="mt-1 text-sm text-muted">多次处理形成的稳定规律仍需你确认；转为成长时会先创建反馈资料。</p></div></template>
    <div v-if="selectedCount" class="learning-batch-bar">
      <span>已选 {{ selectedCount }} 项</span>
      <div class="flex flex-wrap gap-2">
        <UButton size="xs" :loading="loading" @click="submitStatus('active')">确认生效/恢复</UButton>
        <UButton size="xs" color="neutral" variant="soft" :loading="loading" @click="submitStatus('archived')">停用</UButton>
        <UButton size="xs" color="error" variant="soft" :loading="loading" @click="submitStatus('rejected')">拒绝候选</UButton>
      </div>
    </div>
    <div v-if="items.length" class="learning-list">
      <label v-for="item in items" :key="item.id" class="learning-row">
        <input type="checkbox" :checked="selectedIds.includes(item.id)" @change="toggleSelection(item.id, ($event.target as HTMLInputElement).checked)">
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-center gap-2"><UBadge :color="item.status === 'active' ? 'success' : 'neutral'" variant="soft">{{ statusLabel(item.status) }}</UBadge><span class="text-xs text-muted">{{ item.independentEvidenceCount }} 个独立任务依据 · 重要程度 {{ item.importance }}</span></span>
          <strong class="mt-2 block whitespace-pre-wrap text-sm text-highlighted">{{ item.content }}</strong>
          <span class="mt-1 block text-sm text-muted">适用范围：{{ item.scope }}</span>
          <UButton class="mt-2" size="xs" color="neutral" variant="ghost" :loading="loading" @click.prevent="emit('convert', item.id)">转为人物反馈资料</UButton>
        </span>
      </label>
    </div>
    <p v-else class="text-sm text-muted">还没有记忆候选。人物完成多个任务后，可从处理记录发起分析。</p>
  </UCard>
</template>
