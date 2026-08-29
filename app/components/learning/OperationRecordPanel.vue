<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { PersonaOperationRecordView } from '#shared/types/learning'

defineProps<{
  /** 当前人物处理记录。 */
  items: PersonaOperationRecordView[]
  /** 页面级动作是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 批量改变记录是否参加记忆分析。 */
  status: [input: { ids: string[], isEnabled: boolean }]
}>()

const selectedIds = shallowRef<string[]>([])
const selectedCount = computed(() => selectedIds.value.length)

/** @param id 处理记录 UUID。 @param selected 新选择状态。 @returns 无返回值。 */
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

/** @param type 处理类型。 @returns 通俗中文名称。 */
function operationLabel(type: PersonaOperationRecordView['operationType']): string {
  return { interest_assessment: '兴趣判断', artifact_generation: '图文创作', content_analysis: '内容分析' }[type]
}
</script>

<template>
  <UCard>
    <template #header><div><h2 class="font-semibold text-highlighted">人物处理记录</h2><p class="mt-1 text-sm text-muted">任务结果只是记忆分析依据，不会自动成为有效记忆。</p></div></template>
    <div v-if="selectedCount" class="learning-batch-bar">
      <span>已选 {{ selectedCount }} 项</span>
      <div class="flex gap-2">
        <UButton size="xs" :loading="loading" @click="submitStatus(true)">启用</UButton>
        <UButton size="xs" color="neutral" variant="soft" :loading="loading" @click="submitStatus(false)">禁用</UButton>
      </div>
    </div>
    <div v-if="items.length" class="learning-list">
      <label v-for="item in items" :key="item.id" class="learning-row">
        <input type="checkbox" :checked="selectedIds.includes(item.id)" @change="toggleSelection(item.id, ($event.target as HTMLInputElement).checked)">
        <span class="min-w-0 flex-1">
          <span class="flex flex-wrap items-center gap-2"><strong class="text-sm text-highlighted">{{ operationLabel(item.operationType) }}</strong><UBadge :color="item.isEnabled ? 'success' : 'neutral'" variant="soft">{{ item.isEnabled ? '参加分析' : '不参加分析' }}</UBadge></span>
          <span class="mt-1 block text-sm text-muted">{{ item.resultSummary }}</span>
          <NuxtLink :to="`/runs/${item.runId}`" class="mt-2 inline-block text-xs text-primary">查看原任务</NuxtLink>
        </span>
      </label>
    </div>
    <p v-else class="text-sm text-muted">人物还没有完成可用于记忆分析的任务。</p>
  </UCard>
</template>
