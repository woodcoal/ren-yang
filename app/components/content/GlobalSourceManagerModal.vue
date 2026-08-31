<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SourceSummary } from '#shared/types/content'

/** Account 全局资料管理弹窗属性。 */
interface Props {
  /** 弹窗是否打开。 */
  open: boolean
  /** 资料库全部可选资料。 */
  sources: SourceSummary[]
  /** 当前已经生效的全局资料 UUID。 */
  selectedSourceIds: string[]
  /** 父页面是否正在保存。 */
  loading: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  /** 同步弹窗打开状态。 */
  'update:open': [open: boolean]
  /** 提交最终全局资料 UUID 集合。 */
  'save': [sourceIds: string[]]
}>()

/** 当前弹窗内的名称筛选词。 */
const query = ref('')
/** 当前弹窗内尚未提交的选择。 */
const draftSourceIds = ref<string[]>([])

/** 可供模板双向绑定的弹窗状态。 */
const modalOpen = computed({
  get: () => props.open,
  set: (open: boolean) => emit('update:open', open),
})

/** 按资料名称和正文筛选后的可选项。 */
const filteredSources = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  if (!keyword) return props.sources
  return props.sources.filter(source => `${source.name}\n${source.contentText}`.toLocaleLowerCase().includes(keyword))
})

/**
 * 每次打开弹窗时从已生效集合重新建立草稿，关闭时丢弃未提交状态。
 * @param open 最新弹窗状态。
 * @returns 无返回值。
 */
function resetDraft(open: boolean): void {
  if (!open) return
  query.value = ''
  draftSourceIds.value = [...props.selectedSourceIds]
}

watch(() => props.open, resetDraft, { immediate: true })

/**
 * 修改一项全局资料选择状态。
 * @param sourceId 资料 UUID。
 * @param selected 复选框最新状态。
 * @returns 无返回值。
 */
function updateSelection(sourceId: string, selected: boolean | 'indeterminate'): void {
  draftSourceIds.value = selected === true
    ? [...new Set([...draftSourceIds.value, sourceId])]
    : draftSourceIds.value.filter(value => value !== sourceId)
}

/** @returns 无返回值；父页面完成持久化后负责关闭弹窗。 */
function save(): void {
  if (props.loading) return
  emit('save', [...draftSourceIds.value])
}
</script>

<template>
  <UModal v-model:open="modalOpen" title="管理全局资料"
    description="选中的资料会投影到当前 Account 的共享 Resources，所有人物和世界检索时都会自动包含。"
    scrollable :dismissible="!loading" :close="!loading" :ui="{ content: 'max-w-4xl' }">
    <template #body>
      <div class="space-y-4">
        <UInput v-model="query" class="w-full" icon="i-lucide-search" placeholder="按资料名称或正文筛选"
          aria-label="筛选全局资料" />
        <div class="flex items-center justify-between gap-3 text-sm text-muted">
          <span>已选择 {{ draftSourceIds.length }} 项</span>
          <span>共 {{ sources.length }} 项资料</span>
        </div>
        <div v-if="filteredSources.length" class="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          <label v-for="source in filteredSources" :key="source.id"
            class="flex cursor-pointer items-start gap-3 rounded-lg border border-default p-3 hover:bg-elevated">
            <UCheckbox :model-value="draftSourceIds.includes(source.id)" :disabled="loading"
              :aria-label="`选择全局资料：${source.name}`"
              @update:model-value="updateSelection(source.id, $event)" />
            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-center gap-2">
                <strong class="text-sm text-highlighted">{{ source.name }}</strong>
                <UBadge v-if="!source.isEnabled" color="neutral" variant="subtle">已禁用</UBadge>
              </span>
              <span class="mt-1 block line-clamp-2 text-xs text-muted">{{ source.contentText }}</span>
            </span>
          </label>
        </div>
        <div v-else class="rounded-lg border border-dashed border-default p-8 text-center text-sm text-muted">
          没有匹配的资料
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :disabled="loading" @click="modalOpen = false">取消</UButton>
        <UButton icon="i-lucide-save" :loading="loading" @click="save">保存全局资料</UButton>
      </div>
    </template>
  </UModal>
</template>
