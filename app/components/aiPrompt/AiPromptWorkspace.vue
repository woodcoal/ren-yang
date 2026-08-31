<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { AiPromptWorkspaceView } from '#shared/types/aiPrompt'

const props = defineProps<{
  /** 当前业务分类允许编辑的提示词。 */
  prompts: AiPromptWorkspaceView[]
  /** 首次显示时优先选中的提示词编码。 */
  initialCode?: string
}>()

const emit = defineEmits<{
  /** 提示词数据改变后请求页面刷新全部工作区。 */
  refresh: []
  /** 当前提示词的未保存状态变化时通知页面。 */
  dirtyChange: [dirty: boolean]
}>()

const selectedCode = shallowRef(props.initialCode ?? props.prompts[0]?.code ?? '')
const pendingCode = shallowRef<string | null>(null)
const switchConfirmationOpen = shallowRef(false)
const editorDirty = shallowRef(false)
const selectedPrompt = computed(() => props.prompts.find(prompt => prompt.code === selectedCode.value) ?? props.prompts[0] ?? null)

watch(() => props.prompts, synchronizeSelection, { immediate: true })

/**
 * 数据刷新或分类切换后，确保选中编码仍属于当前列表。
 * @param prompts 当前分类的提示词列表。
 * @returns 无返回值。
 */
function synchronizeSelection(prompts: AiPromptWorkspaceView[]): void {
  if (prompts.some(prompt => prompt.code === selectedCode.value)) return
  selectedCode.value = props.initialCode && prompts.some(prompt => prompt.code === props.initialCode)
    ? props.initialCode
    : prompts[0]?.code ?? ''
  editorDirty.value = false
}

/**
 * 请求切换提示词；存在未保存修改时先要求确认。
 * @param code 目标提示词稳定编码。
 * @returns 无返回值。
 */
function requestSelection(code: string): void {
  if (code === selectedPrompt.value?.code) return
  if (editorDirty.value) {
    pendingCode.value = code
    switchConfirmationOpen.value = true
    return
  }
  applySelection(code)
}

/**
 * 应用已确认的提示词选择。
 * @param code 目标提示词稳定编码。
 * @returns 无返回值。
 */
function applySelection(code: string): void {
  selectedCode.value = code
  pendingCode.value = null
  switchConfirmationOpen.value = false
  editorDirty.value = false
}

/**
 * 丢弃当前未保存修改并完成等待中的切换。
 * @returns 无返回值。
 */
function confirmSelection(): void {
  if (pendingCode.value) applySelection(pendingCode.value)
}

/**
 * 记录子编辑器的未保存状态。
 * @param dirty 子编辑器是否存在未保存修改。
 * @returns 无返回值。
 */
function setEditorDirty(dirty: boolean): void {
  editorDirty.value = dirty
  emit('dirtyChange', dirty)
}
</script>

<template>
  <div v-if="selectedPrompt" class="prompt-workspace">
    <aside class="prompt-catalog" aria-label="当前分类提示词">
      <div class="prompt-catalog-heading">
        <strong>提示词</strong>
        <span>{{ prompts.length }} 项</span>
      </div>
      <button
        v-for="prompt in prompts"
        :key="prompt.code"
        type="button"
        class="prompt-catalog-item"
        :class="{ 'prompt-catalog-item--active': prompt.code === selectedPrompt.code }"
        :aria-current="prompt.code === selectedPrompt.code ? 'page' : undefined"
        @click="requestSelection(prompt.code)"
      >
        <span class="prompt-catalog-item-heading"><strong>{{ prompt.name }}</strong><UBadge v-if="prompt.draft" color="warning" variant="subtle" size="sm">有草稿</UBadge></span>
        <span>v{{ prompt.activeVersion?.versionNo ?? '—' }} · {{ prompt.kind === 'text' ? '文本' : '图片' }}</span>
        <code>{{ prompt.code }}</code>
      </button>
    </aside>

    <main class="min-w-0">
      <AiPromptEditor
        :key="selectedPrompt.code"
        :prompt="selectedPrompt"
        @changed="emit('refresh')"
        @dirty-change="setEditorDirty"
      />
    </main>

    <UModal v-model:open="switchConfirmationOpen" title="放弃未保存修改？" description="切换提示词会恢复当前草稿或已发布版本，编辑器里的未保存内容无法找回。">
      <template #footer><UButton variant="ghost" @click="switchConfirmationOpen = false">继续编辑</UButton><UButton color="warning" @click="confirmSelection">放弃并切换</UButton></template>
    </UModal>
  </div>
  <div v-else class="content-empty-state"><div><strong>当前分类没有提示词</strong><p>请检查固定提示词定义是否已初始化。</p></div></div>
</template>

<style scoped>
.prompt-workspace {
  display: grid;
  grid-template-columns: minmax(15rem, 18rem) minmax(0, 1fr);
  align-items: start;
  gap: 1.5rem;
}

.prompt-catalog {
  position: sticky;
  top: 1.5rem;
  overflow: hidden;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-control);
  background: var(--app-surface-raised);
}

.prompt-catalog-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--app-border);
  color: var(--app-muted);
  font-size: 0.75rem;
}

.prompt-catalog-heading strong {
  color: var(--app-fg);
  font-size: 0.875rem;
}

.prompt-catalog-item {
  display: grid;
  width: 100%;
  gap: 0.35rem;
  padding: 1rem;
  border: 0;
  border-bottom: 1px solid var(--app-border);
  background: transparent;
  color: var(--app-muted);
  text-align: left;
  cursor: pointer;
}

.prompt-catalog-item:last-child {
  border-bottom: 0;
}

.prompt-catalog-item:hover,
.prompt-catalog-item--active {
  background: var(--app-surface-soft);
}

.prompt-catalog-item--active {
  box-shadow: inset 3px 0 0 var(--app-accent);
}

.prompt-catalog-item-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  color: var(--app-fg);
}

.prompt-catalog-item > span:not(.prompt-catalog-item-heading),
.prompt-catalog-item code {
  font-size: 0.75rem;
}

@media (max-width: 70rem) {
  .prompt-workspace {
    grid-template-columns: 1fr;
  }

  .prompt-catalog {
    position: static;
  }
}
</style>
