<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import type { GrowthImportSubmission, GrowthSourceOption } from './growthModels'

const MAX_GROWTH_MATERIAL_LENGTH = 200_000

const props = defineProps<{
  /** 当前对象资料库中允许复制为成长素材的资料。 */
  sources: GrowthSourceOption[]
  /** 页面级动作是否正在执行。 */
  loading: boolean
  /** 世界或人物的通俗对象名称。 */
  subjectLabel: string
}>()

const emit = defineEmits<{
  /** 提交逐份评分后的资料批量导入命令。 */
  importSources: [input: GrowthImportSubmission]
}>()

const open = defineModel<boolean>('open', { default: false })
const selectedIds = shallowRef<string[]>([])
const scores = reactive<Record<string, number>>({})
const eligibleSources = computed(() => props.sources.filter(source => source.content.trim().length <= MAX_GROWTH_MATERIAL_LENGTH))
const allEligibleSelected = computed(() => eligibleSources.value.length > 0
  && eligibleSources.value.every(source => selectedIds.value.includes(source.id)))

/**
 * 使用当前服务端资料列表初始化选择和默认评分。
 * @returns 弹窗临时状态重置完成时结束。
 */
function resetImport(): void {
  selectedIds.value = []
  for (const key of Object.keys(scores)) delete scores[key]
  for (const source of props.sources) scores[source.id] = 3
}

/**
 * 修改单份资料是否参加本次导入。
 * @param sourceId 资料 UUID。
 * @param selected 是否选中。
 * @returns 选择集合更新完成时结束。
 */
function toggleSource(sourceId: string, selected: boolean): void {
  selectedIds.value = selected
    ? [...new Set([...selectedIds.value, sourceId])]
    : selectedIds.value.filter(id => id !== sourceId)
}

/**
 * 全选或清空全部符合正文长度限制的资料。
 * @param selected true 表示全选，false 表示清空。
 * @returns 选择集合更新完成时结束。
 */
function toggleAll(selected: boolean): void {
  selectedIds.value = selected ? eligibleSources.value.map(source => source.id) : []
}

/**
 * 把数字输入框的临时值转换为有效的 1–5 分整数。
 * @param sourceId 当前资料 UUID。
 * @param value Nuxt UI 数字输入框返回的原始值。
 * @returns 评分状态更新完成时结束。
 */
function updateScore(sourceId: string, value: string | number | bigint | boolean | null): void {
  const numericValue = value === null || value === '' || typeof value === 'boolean' ? 3 : Number(value)
  scores[sourceId] = Number.isFinite(numericValue) ? Math.min(5, Math.max(1, Math.round(numericValue))) : 3
}

/**
 * 按资料库顺序提交来源 UUID 和逐项 AI 提炼评分。
 * @returns 导入事件发出且弹窗关闭后结束。
 */
function submitImport(): void {
  if (!selectedIds.value.length) return
  const selected = new Set(selectedIds.value)
  emit('importSources', {
    items: props.sources
      .filter(source => selected.has(source.id))
      .map(source => ({ sourceId: source.id, importance: scores[source.id] ?? 3 })),
  })
  open.value = false
}

// 每次打开都重新使用最新资料库状态，避免重复提交上次选择。
watch(open, (isOpen) => {
  if (isOpen) resetImport()
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`从${subjectLabel}资料库选择成长素材`"
    description="导入会复制当前资料全文作为固定素材快照；已导入资料可再次选择以刷新快照和评分。"
    scrollable
    :dismissible="!loading"
    :close="!loading"
    :ui="{ content: 'max-w-4xl' }"
  >
    <template #body>
      <form data-growth-import-form class="space-y-4" @submit.prevent="submitImport">
        <template v-if="sources.length">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-default pb-3">
            <label class="flex items-center gap-2 text-sm font-medium text-highlighted">
              <input type="checkbox" :checked="allEligibleSelected" :disabled="loading || !eligibleSources.length" @change="toggleAll(($event.target as HTMLInputElement).checked)">
              全选可导入资料
            </label>
            <span class="text-xs text-muted">已选 {{ selectedIds.length }} / {{ eligibleSources.length }} 项</span>
          </div>

          <article
            v-for="source in sources"
            :key="source.id"
            data-growth-import-source
            class="growth-import-source"
            :aria-disabled="source.content.trim().length > MAX_GROWTH_MATERIAL_LENGTH"
          >
            <input
              type="checkbox"
              :checked="selectedIds.includes(source.id)"
              :disabled="loading || source.content.trim().length > MAX_GROWTH_MATERIAL_LENGTH"
              :aria-label="`选择资料 ${source.label}`"
              @change="toggleSource(source.id, ($event.target as HTMLInputElement).checked)"
            >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <strong class="text-sm text-highlighted">{{ source.label }}</strong>
                <UBadge v-if="source.isImported" color="primary" variant="soft">已在素材池</UBadge>
                <UBadge :color="source.isEnabled ? 'success' : 'neutral'" variant="soft">{{ source.isEnabled ? '资料已启用' : '资料已禁用' }}</UBadge>
              </div>
              <p class="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted">{{ source.content }}</p>
              <p v-if="source.content.trim().length > MAX_GROWTH_MATERIAL_LENGTH" class="mt-1 text-xs text-error">正文超过 200000 字，无法导入。</p>
            </div>
            <UFormField label="评分" description="1–5 分" class="w-24 shrink-0">
              <UInput
                :model-value="scores[source.id] ?? 3"
                type="number"
                min="1"
                max="5"
                :disabled="loading || !selectedIds.includes(source.id)"
                @update:model-value="updateScore(source.id, $event)"
              />
            </UFormField>
          </article>
        </template>
        <UAlert v-else color="neutral" title="资料库为空" :description="`请先在“资料”标签中给这个${subjectLabel}加入资料。`" />

        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="loading" @click="open = false">取消</UButton>
          <UButton type="submit" :loading="loading" :disabled="!selectedIds.length">导入 {{ selectedIds.length }} 项资料</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
