<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import type { GrowthImportSubmission, GrowthSourceOption } from './growthModels'

const MAX_GROWTH_CONTENT_LENGTH = 20_000

const props = defineProps<{
  /** 当前对象允许作为成长证据的原始资料。 */
  sources: GrowthSourceOption[]
  /** 页面级动作是否正在执行。 */
  loading: boolean
  /** 世界或人物的通俗对象名称。 */
  subjectLabel: string
}>()

const emit = defineEmits<{
  /** 提交按逐条评分整理的批量导入命令。 */
  importSources: [input: GrowthImportSubmission]
}>()

const open = defineModel<boolean>('open', { default: false })
const selectedIds = shallowRef<string[]>([])
const scores = reactive<Record<string, number>>({})
const scope = shallowRef('所有新任务')
const displaySources = computed(() => props.sources.map(source => ({
  source,
  importable: source.content.trim().length <= MAX_GROWTH_CONTENT_LENGTH,
})))
const eligibleSources = computed(() => displaySources.value.filter(entry => entry.importable).map(entry => entry.source))
const allEligibleSelected = computed(() => eligibleSources.value.length > 0
  && eligibleSources.value.every(source => selectedIds.value.includes(source.id)))

/**
 * 清空选择并把当前每份资料的默认评分恢复为 3 分。
 * @returns 弹窗导入状态初始化完成后结束，无业务返回值。
 */
function resetImport(): void {
  selectedIds.value = []
  scope.value = '所有新任务'
  for (const key of Object.keys(scores)) delete scores[key]
  for (const source of props.sources) scores[source.id] = 3
}

/**
 * 修改单份资料的选择状态，同时保持来源原始展示顺序。
 * @param sourceId 资料 UUID。
 * @param selected 是否加入本次导入。
 * @returns 选择集合更新完成后结束，无业务返回值。
 */
function toggleSource(sourceId: string, selected: boolean): void {
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, sourceId])]
    : selectedIds.value.filter(id => id !== sourceId)
}

/**
 * 全选或清空全部符合 20000 字限制的资料。
 * @param selected true 表示全选，false 表示清空。
 * @returns 批量选择更新完成后结束，无业务返回值。
 */
function toggleAll(selected: boolean): void {
  selectedIds.value = selected ? eligibleSources.value.map(source => source.id) : []
}

/**
 * 提交当前选择和逐条人工评分，正文仍由服务端按来源 UUID 读取。
 * @returns 发出批量导入事件并关闭弹窗后结束，无业务返回值。
 */
function submitImport(): void {
  const normalizedScope = scope.value.trim()
  if (!normalizedScope || selectedIds.value.length === 0) return
  const selectedSet = new Set(selectedIds.value)
  emit('importSources', {
    scope: normalizedScope,
    items: props.sources
      .filter(source => selectedSet.has(source.id))
      .map(source => ({ sourceId: source.id, importance: scores[source.id] ?? 3 })),
  })
  open.value = false
}

// 弹窗每次开启都从当前服务端资料快照重新开始，避免重复提交旧选择。
watch(open, (isOpen) => {
  if (isOpen) resetImport()
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`从资料导入${subjectLabel}成长`"
    description="每份资料生成一条独立待确认成长；评分直接作为重要程度。"
    scrollable
    :dismissible="!loading"
    :close="!loading"
    :ui="{ content: 'max-w-4xl' }"
  >
    <template #body>
      <form data-growth-import-form class="space-y-4" @submit.prevent="submitImport">
        <UFormField label="适用范围" description="本批资料导入后共用，可再逐条修改。" required>
          <UInput v-model="scope" class="w-full" maxlength="500" :disabled="loading" />
        </UFormField>

        <div v-if="sources.length" class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-default pb-3">
            <label class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <input type="checkbox" :checked="allEligibleSelected" :disabled="loading || !eligibleSources.length" @change="toggleAll(($event.target as HTMLInputElement).checked)">
              全选可导入资料
            </label>
            <span class="text-xs text-muted">已选 {{ selectedIds.length }} / {{ eligibleSources.length }} 项</span>
          </div>

          <article
            v-for="entry in displaySources"
            :key="entry.source.id"
            data-growth-import-source
            class="growth-import-source"
            :aria-disabled="!entry.importable"
          >
            <input
              type="checkbox"
              :checked="selectedIds.includes(entry.source.id)"
              :disabled="loading || !entry.importable"
              :aria-label="`选择资料 ${entry.source.label}`"
              @change="toggleSource(entry.source.id, ($event.target as HTMLInputElement).checked)"
            >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <strong class="text-sm text-highlighted">{{ entry.source.label }}</strong>
                <UBadge :color="entry.source.isEnabled ? 'success' : 'neutral'" variant="soft">{{ entry.source.isEnabled ? '自动分析已启用' : '自动分析已禁用' }}</UBadge>
              </div>
              <p class="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted">{{ entry.source.content }}</p>
              <p v-if="!entry.importable" class="mt-1 text-xs text-error">正文超过 20000 字，请先整理后再导入。</p>
            </div>
            <UFormField label="评分" description="1–5 分" class="w-24 shrink-0">
              <UInput v-model.number="scores[entry.source.id]" type="number" min="1" max="5" :disabled="loading || !selectedIds.includes(entry.source.id)" />
            </UFormField>
          </article>
        </div>
        <p v-else class="text-sm text-muted">当前没有可导入的成长资料。</p>

        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="loading" @click="open = false">取消</UButton>
          <UButton type="submit" :loading="loading" :disabled="!scope.trim() || !selectedIds.length">导入 {{ selectedIds.length }} 项资料</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
