<script setup lang="ts">
import { computed } from 'vue'
import type { GrowthRecordView } from '#shared/types/learning'

const props = defineProps<{
  /** 当前页成长修订。 */
  items: GrowthRecordView[]
  /** 跨页已选择成长 UUID。 */
  selectedIds: string[]
  /** 页面级动作是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 修改单条成长选择状态。 */
  toggle: [id: string, selected: boolean]
  /** 请求修改指定成长。 */
  edit: [item: GrowthRecordView]
}>()

const displayItems = computed(() => props.items.map(item => ({
  item,
  preview: item.content.length > 360 ? `${item.content.slice(0, 360)}…` : item.content,
  truncated: item.content.length > 360,
})))

/**
 * 把成长生命周期状态转换为管理员可直接理解的中文标签。
 * @param status 成长当前生命周期状态。
 * @returns 对应的中文状态名称。
 */
function statusLabel(status: GrowthRecordView['status']): string {
  return { candidate: '待确认', active: '已启用', superseded: '已取代', archived: '已禁用', rejected: '已拒绝' }[status]
}
</script>

<template>
  <div class="learning-list">
    <article v-for="entry in displayItems" :key="entry.item.id" class="learning-row">
      <input
        data-growth-row-checkbox
        type="checkbox"
        :checked="selectedIds.includes(entry.item.id)"
        :disabled="loading"
        :aria-label="`选择成长：${entry.preview}`"
        @change="emit('toggle', entry.item.id, ($event.target as HTMLInputElement).checked)"
      >
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <UBadge :color="entry.item.status === 'active' ? 'success' : 'neutral'" variant="soft">{{ statusLabel(entry.item.status) }}</UBadge>
          <span class="text-xs text-muted">修订 {{ entry.item.revisionNo }} · 重要程度 {{ entry.item.importance }} · {{ entry.item.evidenceCount }} 项依据</span>
        </div>
        <p class="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-highlighted">{{ entry.preview }}</p>
        <details v-if="entry.truncated" class="mt-2 text-sm text-muted">
          <summary class="cursor-pointer text-primary">查看完整内容</summary>
          <p class="mt-2 whitespace-pre-wrap leading-6">{{ entry.item.content }}</p>
        </details>
        <p v-if="entry.item.conflictSummary" class="mt-1 text-sm text-warning">冲突：{{ entry.item.conflictSummary }}</p>
      </div>
      <UButton
        v-if="entry.item.status !== 'superseded'"
        data-growth-edit-button
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-pencil"
        :disabled="loading"
        @click="emit('edit', entry.item)"
      >修改</UButton>
    </article>
  </div>
</template>
