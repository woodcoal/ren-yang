<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
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

const pageSize = 10
const page = shallowRef(1)
const selectedIds = shallowRef<string[]>([])
const selectedCount = computed(() => selectedIds.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(props.items.length / pageSize)))
const pagedItems = computed(() => props.items.slice((page.value - 1) * pageSize, page.value * pageSize))
const currentPageSelected = computed(() => pagedItems.value.length > 0
  && pagedItems.value.every(item => selectedIds.value.includes(item.id)))

/**
 * 修改单份世界资料的跨页选择状态。
 * @param id 资料 UUID。
 * @param selected 是否选中。
 * @returns 选择集合更新完成后结束，无业务返回值。
 */
function toggleSelection(id: string, selected: boolean): void {
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter(item => item !== id)
}

/**
 * 全选或清空当前页世界资料，不影响其他页选择。
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
 * 批量修改所选世界资料的成长分析启用状态。
 * @param isEnabled true 表示启用，false 表示禁用。
 * @returns 状态事件发出并清空选择后结束，无业务返回值。
 */
function submitStatus(isEnabled: boolean): void {
  if (selectedIds.value.length === 0) return
  emit('status', { ids: [...selectedIds.value], isEnabled })
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
      <div>
        <h2 class="font-semibold text-highlighted">参加成长分析的世界资料</h2>
        <p class="mt-1 text-sm text-muted">只控制下一次分析输入；也可在右侧直接按资料评分导入成长。</p>
      </div>
    </template>

    <div v-if="selectedCount" class="learning-batch-bar mb-4">
      <span>已选 {{ selectedCount }} 项</span>
      <div class="flex gap-2">
        <UButton size="xs" :loading="loading" @click="submitStatus(true)">启用</UButton>
        <UButton size="xs" color="neutral" variant="soft" :loading="loading" @click="submitStatus(false)">禁用</UButton>
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
          <input type="checkbox" :checked="selectedIds.includes(item.id)" :disabled="loading" :aria-label="`选择世界资料 ${item.name}`" @change="toggleSelection(item.id, ($event.target as HTMLInputElement).checked)">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <strong class="text-sm text-highlighted">{{ item.name }}</strong>
              <UBadge :color="item.isEnabled ? 'success' : 'neutral'" variant="soft">{{ item.isEnabled ? '已启用' : '已禁用' }}</UBadge>
            </div>
            <p class="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted">{{ item.summary }}</p>
          </div>
        </article>
      </div>
      <div v-if="items.length > pageSize" class="mt-4 flex items-center justify-between gap-3 border-t border-default pt-4">
        <span class="text-xs text-muted">第 {{ page }} / {{ totalPages }} 页</span>
        <UPagination v-model:page="page" :total="items.length" :items-per-page="pageSize" size="sm" :disabled="loading" />
      </div>
    </template>
    <p v-else class="text-sm text-muted">当前世界没有关联资料。请先在“世界资料”中添加或关联资料。</p>
  </UCard>
</template>
