<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { WorldGrowthSourceView } from '#shared/types/learning'

const props = defineProps<{
  /** 当前世界关联的成长资料。 */
  items: WorldGrowthSourceView[]
  /** 页面级动作是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 批量改变资料是否参加分析。 */
  status: [input: { ids: string[], isEnabled: boolean }]
}>()

const selectedIds = shallowRef<string[]>([])
const selectedCount = computed(() => selectedIds.value.length)

/** @param id 资料 UUID。 @param selected 新选择状态。 @returns 无返回值。 */
function toggleSelection(id: string, selected: boolean): void {
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter(item => item !== id)
}

/** @param isEnabled 是否启用。 @returns 无返回值。 */
function submitStatus(isEnabled: boolean): void {
  if (selectedIds.value.length === 0) return
  emit('status', { ids: selectedIds.value, isEnabled })
  selectedIds.value = []
}
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="font-semibold text-highlighted">参加成长分析的世界资料</h2>
        <p class="mt-1 text-sm text-muted">只控制下一次分析输入，不会直接删除资料或改变已确认成长。</p>
      </div>
    </template>

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
          <span class="flex flex-wrap items-center gap-2">
            <strong class="text-sm text-highlighted">{{ item.name }}</strong>
            <UBadge :color="item.isEnabled ? 'success' : 'neutral'" variant="soft">{{ item.isEnabled ? '已启用' : '已禁用' }}</UBadge>
          </span>
          <span class="mt-1 block line-clamp-2 text-sm text-muted">{{ item.summary }}</span>
        </span>
      </label>
    </div>
    <p v-else class="text-sm text-muted">当前世界没有关联资料。请先在“世界资料”中添加或关联资料。</p>
  </UCard>
</template>
