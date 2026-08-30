<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { PersonaOperationRecordView } from '#shared/types/learning'

const props = defineProps<{
  /** 当前人物历史任务形成的记忆素材。 */
  items: PersonaOperationRecordView[]
  /** 页面级动作是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 批量改变历史任务是否参加记忆提炼。 */
  status: [input: { ids: string[], isEnabled: boolean }]
  /** 修改单条历史任务的 AI 提炼评分。 */
  importance: [input: { id: string, importance: number }]
}>()

const pageSizeOptions = [5, 10, 20, 50].map(value => ({ label: `${value} 项/页`, value }))
const page = shallowRef(1)
const pageSize = shallowRef(10)
const selectedIds = shallowRef<string[]>([])
const totalPages = computed(() => Math.max(1, Math.ceil(props.items.length / pageSize.value)))
const pagedItems = computed(() => props.items.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const currentPageSelected = computed(() => pagedItems.value.length > 0
  && pagedItems.value.every(item => selectedIds.value.includes(item.id)))

/**
 * 修改单条历史任务的跨页选择状态。
 * @param id 处理记录 UUID。
 * @param selected 是否选中。
 * @returns 选择集合更新完成时结束。
 */
function toggleSelection(id: string, selected: boolean): void {
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter(item => item !== id)
}

/**
 * 全选或清空当前页历史任务，不影响其他页选择。
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
 * 提交所选历史任务的统一启用状态。
 * @param isEnabled 是否参加下一次 AI 记忆提炼。
 * @returns 状态事件发出且选择清空后结束。
 */
function submitStatus(isEnabled: boolean): void {
  if (!selectedIds.value.length) return
  emit('status', { ids: [...selectedIds.value], isEnabled })
  selectedIds.value = []
}

/**
 * 提交单条历史任务的 1–5 分提炼权重。
 * @param item 当前历史任务记录。
 * @param value 原生数值输入框的新值。
 * @returns 合法且变化时发出评分修改命令，否则直接结束。
 */
function updateImportance(item: PersonaOperationRecordView, value: string): void {
  const importance = Number(value)
  if (!Number.isInteger(importance) || importance < 1 || importance > 5 || importance === item.importance) return
  emit('importance', { id: item.id, importance })
}

/**
 * 把处理类型转换为通俗中文名称。
 * @param type 处理记录类型。
 * @returns 对应中文标签。
 */
function operationLabel(type: PersonaOperationRecordView['operationType']): string {
  return { interest_assessment: '兴趣判断', artifact_generation: '图文创作', content_analysis: '内容分析' }[type]
}

// 服务端刷新后清理不存在的跨页选择，并收拢越界页码。
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
      <div>
        <h2 class="font-semibold text-highlighted">历史任务素材池</h2>
        <p class="mt-1 text-sm text-muted">成功或部分成功任务会形成固定素材；评分越高，AI 提炼记忆时权重越高。</p>
      </div>
    </template>

    <div v-if="selectedIds.length" class="learning-batch-bar mb-4">
      <span>已选 {{ selectedIds.length }} 项</span>
      <div class="flex flex-wrap gap-2">
        <UButton size="xs" :loading="loading" @click="submitStatus(true)">批量启用</UButton>
        <UButton size="xs" color="neutral" variant="soft" :loading="loading" @click="submitStatus(false)">批量禁用</UButton>
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
          <USelect v-model="pageSize" :items="pageSizeOptions" size="xs" class="w-28" aria-label="每页历史任务数量" />
        </div>
      </div>

      <div class="learning-list">
        <article v-for="item in pagedItems" :key="item.id" class="learning-row">
          <input
            data-operation-row-checkbox
            type="checkbox"
            :checked="selectedIds.includes(item.id)"
            :disabled="loading"
            :aria-label="`选择历史任务素材：${item.title}`"
            @change="toggleSelection(item.id, ($event.target as HTMLInputElement).checked)">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <NuxtLink :to="`/runs/${item.runId}`" class="text-sm font-semibold text-highlighted hover:underline">{{ item.title || operationLabel(item.operationType) }}</NuxtLink>
              <UBadge color="neutral" variant="soft">{{ operationLabel(item.operationType) }}</UBadge>
              <UBadge :color="item.isEnabled ? 'success' : 'neutral'" variant="soft">{{ item.isEnabled ? '参加提炼' : '不参加提炼' }}</UBadge>
            </div>
            <p class="mt-2 text-sm text-muted">{{ item.resultSummary }}</p>
            <details class="mt-2 text-sm text-muted">
              <summary class="cursor-pointer text-primary">查看素材正文</summary>
              <p class="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap leading-6">{{ item.content }}</p>
            </details>
            <NuxtLink :to="`/runs/${item.runId}`" class="mt-2 inline-block text-xs text-primary">查看原任务</NuxtLink>
          </div>
          <UFormField label="评分" class="w-20 shrink-0">
            <UInput
              :model-value="item.importance"
              type="number"
              min="1"
              max="5"
              :disabled="loading"
              :aria-label="`修改${item.title}的提炼评分`"
              @change="updateImportance(item, ($event.target as HTMLInputElement).value)"
            />
          </UFormField>
        </article>
      </div>

      <div v-if="items.length > pageSize" class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
        <span class="text-xs text-muted">第 {{ page }} / {{ totalPages }} 页</span>
        <UPagination v-model:page="page" :total="items.length" :items-per-page="pageSize" size="sm" :disabled="loading" />
      </div>
    </template>
    <p v-else class="text-sm text-muted">人物还没有成功或部分成功的历史任务可用于记忆提炼。</p>
  </UCard>
</template>
