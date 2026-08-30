<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, shallowRef, watch } from 'vue'
import { saveSoulDraftSchema, type SaveSoulDraftInput } from '#shared/schemas/content'
import type { SoulVersionView, SoulWorkspaceView } from '#shared/types/content'

/** 灵魂工作区属性。 */
interface Props {
  /** 世界或人物灵魂工作区数据。 */
  workspace: SoulWorkspaceView
  /** 页面动作是否正在执行。 */
  loading: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 保存当前可编辑的单文本草稿。 */
  save: [input: SaveSoulDraftInput]
  /** 发布当前草稿。 */
  publish: []
  /** 删除当前草稿。 */
  delete: []
  /** 从指定历史版本建立当前草稿。 */
  'from-version': [versionId: string]
}>()

/** 是否显示单文本灵魂编辑弹窗。 */
const editorOpen = shallowRef(false)
/** 弹窗内唯一可编辑的灵魂事实和处理方式。 */
const editor = reactive<SaveSoulDraftInput>({
  baseVersionId: null,
  snapshot: { promptText: '' },
  autoAnalyze: false,
})
/** 编辑区灵魂文本的保守 Token 估算，仅用于即时提示。 */
const estimatedTokens = computed(() => Math.ceil(new TextEncoder().encode(editor.snapshot.promptText).length / 3))
/** 当前对象的通俗中文名称。 */
const subjectLabel = computed(() => props.workspace.subjectType === 'world' ? '世界' : '人物')

/**
 * 使用当前草稿、已发布版本或空文本打开灵魂编辑弹窗。
 * @returns 无返回值。
 */
function openEditor(): void {
  const source = props.workspace.draft ?? props.workspace.activeVersion
  editor.baseVersionId = props.workspace.draft?.baseVersionId ?? props.workspace.activeVersion?.id ?? null
  editor.snapshot.promptText = source?.snapshot.promptText ?? ''
  editor.autoAnalyze = false
  editorOpen.value = true
}

/**
 * 把指定历史版本载入单文本编辑弹窗，但不立即写入服务端。
 * @param version 指定历史灵魂版本。
 * @returns 无返回值。
 */
function editVersion(version: SoulVersionView): void {
  editor.baseVersionId = version.id
  editor.snapshot.promptText = version.snapshot.promptText
  editor.autoAnalyze = false
  editorOpen.value = true
}

/**
 * 上送已经通过共享 Schema 校验的单文本草稿。
 * @param event Nuxt UI 表单提交事件。
 * @returns 无返回值。
 */
function handleSave(event: FormSubmitEvent<SaveSoulDraftInput>): void {
  emit('save', event.data)
}

/**
 * 格式化发布历史时间。
 * @param timestamp UTC Unix 毫秒。
 * @returns 本地中文时间。
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

/**
 * AI 或手动保存完成后，把服务端返回的最终草稿同步回仍然打开的文本框。
 * @param updatedAt 草稿最后更新时间；没有草稿时为 undefined。
 * @returns 无返回值。
 */
function synchronizeSavedDraft(updatedAt: number | undefined): void {
  if (!editorOpen.value || updatedAt === undefined || !props.workspace.draft) return
  editor.baseVersionId = props.workspace.draft.baseVersionId
  editor.snapshot.promptText = props.workspace.draft.snapshot.promptText
  editor.autoAnalyze = false
}

watch(() => props.workspace.draft?.updatedAt, synchronizeSavedDraft)
</script>

<template>
  <div class="space-y-6">
    <div class="grid gap-6 xl:grid-cols-2">
      <UCard>
        <template #header>
          <div>
            <p class="text-xs font-medium uppercase tracking-wider text-muted">当前已发布</p>
            <h2 class="mt-1 font-semibold text-highlighted">新任务正在使用的灵魂提示词</h2>
          </div>
        </template>
        <template v-if="workspace.activeVersion">
          <p class="whitespace-pre-wrap text-sm leading-6 text-muted">{{ workspace.activeVersion.snapshot.promptText }}</p>
          <p class="mt-4 text-xs text-dimmed">{{ workspace.activeVersion.runtimeTokenCount }} Token · {{ formatTime(workspace.activeVersion.publishedAt) }}</p>
        </template>
        <UAlert v-else color="warning" title="还没有已发布灵魂" :description="`先新建${subjectLabel}灵魂并确认发布；未发布前不能用于新任务。`" />
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs font-medium uppercase tracking-wider text-muted">未发布修改稿</p>
              <h2 class="mt-1 font-semibold text-highlighted">发布前不会影响任何任务</h2>
            </div>
            <UBadge :color="workspace.draft ? 'warning' : 'neutral'" variant="subtle">{{ workspace.draft ? '等待确认' : '没有修改稿' }}</UBadge>
          </div>
        </template>
        <p v-if="workspace.draft" class="whitespace-pre-wrap text-sm leading-6 text-muted">{{ workspace.draft.snapshot.promptText }}</p>
        <p v-else class="text-sm leading-6 text-muted">灵魂只有一段提示词。可以直接录入原文，也可以让 AI 在不增加事实的前提下整理格式。</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <UButton icon="i-lucide-pencil" color="neutral" variant="soft" :disabled="loading" @click="openEditor">{{ workspace.draft || workspace.activeVersion ? '修改灵魂' : '新建灵魂' }}</UButton>
          <UButton v-if="workspace.draft" :loading="loading" @click="emit('publish')">确认并发布</UButton>
          <UButton v-if="workspace.draft" color="error" variant="ghost" :disabled="loading" @click="emit('delete')">删除修改稿</UButton>
        </div>
      </UCard>
    </div>

    <UCard>
      <template #header>
        <div>
          <h2 class="font-semibold text-highlighted">已发布版本</h2>
          <p class="mt-1 text-sm text-muted">历史版本只读。需要恢复时，复制成修改稿后重新确认发布。</p>
        </div>
      </template>
      <div v-if="workspace.versions.length" class="space-y-3">
        <article v-for="version in workspace.versions" :key="version.id" class="rounded-lg border border-default p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <UBadge :color="version.id === workspace.activeVersion?.id ? 'primary' : 'neutral'" variant="subtle">{{ version.id === workspace.activeVersion?.id ? '正在使用' : '历史版本' }}</UBadge>
                <span class="font-medium text-highlighted">{{ version.changeSummary }}</span>
              </div>
              <p class="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-muted">{{ version.snapshot.promptText }}</p>
              <p class="mt-2 text-xs text-muted">{{ formatTime(version.publishedAt) }} · {{ version.runtimeTokenCount }} Token</p>
            </div>
            <div class="flex gap-2">
              <UButton color="neutral" variant="ghost" :disabled="loading" @click="editVersion(version)">查看并修改</UButton>
              <UButton color="neutral" variant="soft" :disabled="loading" @click="emit('from-version', version.id)">复制为修改稿</UButton>
            </div>
          </div>
        </article>
      </div>
      <p v-else class="text-sm text-muted">发布第一份灵魂后，这里会保留完整版本记录。</p>
    </UCard>

    <UModal v-model:open="editorOpen" :title="`${workspace.draft || workspace.activeVersion ? '修改' : '新建'}${subjectLabel}灵魂`" description="灵魂是一段直接进入新任务的提示词。" :dismissible="!loading" :close="!loading" :ui="{ content: 'max-w-4xl' }">
      <template #body>
        <UForm :schema="saveSoulDraftSchema" :state="editor" class="space-y-4" data-soul-prompt-form @submit="handleSave">
          <UFormField name="snapshot.promptText" label="灵魂提示词" description="不勾选自动分析时，系统会按原文保存。" required>
            <UTextarea v-model="editor.snapshot.promptText" class="w-full" :rows="16" autoresize :disabled="loading" placeholder="输入人物核心人设，或世界背景、规则与边界……" />
          </UFormField>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <UCheckbox v-model="editor.autoAnalyze" data-soul-auto-analyze label="自动分析并整理为标准提示词" :disabled="loading" />
            <UBadge color="neutral" variant="subtle">预计 {{ estimatedTokens }} Token</UBadge>
          </div>
          <UAlert v-if="editor.autoAnalyze" color="info" title="AI 只整理表达" description="不会增加新设定；整理结果保存为修改稿，确认发布前不会影响任务。" />
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" :disabled="loading" @click="editorOpen = false">关闭</UButton>
            <UButton type="submit" :loading="loading">{{ editor.autoAnalyze ? '分析并保存修改稿' : '保存修改稿' }}</UButton>
          </div>
        </UForm>
      </template>
    </UModal>
  </div>
</template>
