<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import type { SaveLearningPromptDraftInput } from '#shared/schemas/learning'
import type { AnalysisBatchView } from '#shared/types/analysis'
import type { LearningPromptVersionView, LearningPromptWorkspaceView } from '#shared/types/learning'

/** 成长或记忆提示词编辑器属性。 */
interface Props {
  /** 当前学习提示词的草稿、已发布版本和历史。 */
  workspace: LearningPromptWorkspaceView
  /** 当前对象最近一次 AI 提炼批次。 */
  batch: AnalysisBatchView | null
  /** 页面级动作是否正在执行。 */
  loading: boolean
  /** 展示标题，例如“人物成长”或“人物记忆”。 */
  title: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  /** 从全部启用素材重新生成一份完整提示词草稿。 */
  analyze: [mode: 'full_rebuild']
  /** 重新读取 AI 批次状态和最新草稿。 */
  refresh: []
  /** 保存编辑框正文并立即发布为后续任务使用的新版本。 */
  saveAndPublish: [input: SaveLearningPromptDraftInput]
}>()

/** 当前直接编辑的完整提示词及其历史基线。 */
const editor = reactive<SaveLearningPromptDraftInput>({
  promptText: '',
  baseVersionId: null,
})
/** 是否显示全部已发布提示词历史。 */
const historyOpen = shallowRef(false)
/** 当前 AI 批次是否仍在排队或执行。 */
const analysisPending = computed(() => props.batch?.status === 'queued' || props.batch?.status === 'running')
/** 编辑框内容的保守 Token 估算，仅用于即时提示。 */
const estimatedTokens = computed(() => Math.ceil(new TextEncoder().encode(editor.promptText).length / 3))
/** 编辑内容相对当前生效版本是否发生变化。 */
const hasChanges = computed(() => {
  const promptText = editor.promptText.trim()
  if (!promptText) return false
  const activeVersion = props.workspace.activeVersion
  if (!activeVersion) return true
  return editor.baseVersionId !== activeVersion.id || promptText !== activeVersion.promptText
})

/**
 * 使用最新草稿初始化编辑器；没有草稿时显示当前已发布版本。
 * @returns 编辑器正文和版本基线同步完成时结束。
 */
function synchronizeEditor(): void {
  const source = props.workspace.draft ?? props.workspace.activeVersion
  editor.promptText = source?.promptText ?? ''
  editor.baseVersionId = props.workspace.draft?.baseVersionId ?? props.workspace.activeVersion?.id ?? null
}

/**
 * 将指定历史版本载入编辑框，不立即改变正在使用的版本。
 * @param version 用户选择的不可变提示词历史版本。
 * @returns 编辑器完成回填且历史弹窗关闭时结束。
 */
function selectHistoryVersion(version: LearningPromptVersionView): void {
  editor.promptText = version.promptText
  editor.baseVersionId = version.id
  historyOpen.value = false
}

/**
 * 请求从全部启用素材重新生成完整提示词草稿。
 * @returns 当前没有重复批次时发出生成事件，否则直接结束。
 */
function requestAnalysis(): void {
  if (props.loading || analysisPending.value) return
  emit('analyze', 'full_rebuild')
}

/**
 * 保存编辑框中的完整正文并立即发布为新版本。
 * @returns 正文有效且发生变化时发出保存发布事件，否则直接结束。
 */
function saveAndPublish(): void {
  const promptText = editor.promptText.trim()
  if (!promptText || !hasChanges.value || props.loading || analysisPending.value) return
  emit('saveAndPublish', { promptText, baseVersionId: editor.baseVersionId })
}

/**
 * 格式化提示词历史发布时间。
 * @param timestamp UTC Unix 毫秒。
 * @returns 本地中文日期时间。
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

/**
 * 返回 AI 提炼批次的通俗中文状态。
 * @param status 服务端批次状态。
 * @returns 可直接展示的中文状态。
 */
function analysisStatusLabel(status: AnalysisBatchView['status']): string {
  return {
    queued: '等待生成',
    running: '生成中',
    awaiting_review: '旧批次待审核',
    completed: '生成完成',
    failed: '生成失败',
  }[status]
}

// 仅在服务端草稿或当前版本变化时同步，避免状态刷新覆盖尚未保存的人工编辑。
watch(
  () => [props.workspace.draft?.id, props.workspace.draft?.updatedAt, props.workspace.activeVersion?.id],
  synchronizeEditor,
  { immediate: true },
)
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold text-highlighted">{{ title }}提示词</h2>
          <p class="mt-1 text-sm text-muted">AI 生成结果只会回填编辑框；检查并保存发布后，才会用于后续新任务。</p>
        </div>
        <UBadge :color="workspace.activeVersion ? 'success' : 'neutral'" variant="soft">
          {{ workspace.activeVersion ? `当前版本 ${workspace.activeVersion.versionNo}` : '尚未发布' }}
        </UBadge>
      </div>
    </template>

    <form class="space-y-4" @submit.prevent="saveAndPublish">
      <UFormField :label="`${title}提示词`" description="可直接手工校准完整提示词；发布时会自动保留上一版历史。" required>
        <UTextarea
          v-model="editor.promptText"
          data-learning-prompt-editor
          class="w-full"
          :rows="20"
          autoresize
          :maxrows="32"
          maxlength="20000"
          :disabled="loading || analysisPending"
          placeholder="输入完整提示词，或让 AI 从全部启用素材中重新生成……"
        />
      </UFormField>

      <UAlert
        v-if="batch?.errorMessage"
        color="error"
        title="提炼没有完成"
        :description="batch.errorMessage"
      />
      <UAlert
        v-else-if="analysisPending"
        color="info"
        :title="analysisStatusLabel(batch!.status)"
        description="当前生成完成前不能重复提交；可刷新状态查看最新结果。"
      />
      <UAlert
        v-else-if="batch?.status === 'completed' && workspace.draft?.sourceAnalysisBatchId === batch.id"
        color="success"
        title="完整提示词草稿已生成"
        :description="batch.resultSummary || 'AI 结果已经载入编辑框，请检查后保存发布。'"
      />

      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-1">
          <UButton
            type="button"
            data-learning-analyze-button
            icon="i-lucide-wand-sparkles"
            color="neutral"
            variant="ghost"
            :disabled="loading || analysisPending"
            @click="requestAnalysis"
          >重新 AI 生成提示词</UButton>
          <UButton
            type="button"
            data-learning-history-button
            icon="i-lucide-history"
            color="neutral"
            variant="ghost"
            :disabled="loading || analysisPending"
            @click="historyOpen = true"
          >历史</UButton>
          <UButton
            type="button"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :disabled="loading"
            @click="emit('refresh')"
          >刷新状态</UButton>
          <span class="ml-2 text-xs text-muted">预计 {{ estimatedTokens }} Token</span>
        </div>
        <UButton
          type="button"
          data-learning-save-publish-button
          icon="i-lucide-send"
          :loading="loading"
          :disabled="!hasChanges || analysisPending"
          @click="saveAndPublish"
        >保存并发布</UButton>
      </div>
    </form>
  </UCard>

  <UModal v-model:open="historyOpen" :title="`${title}提示词历史`" description="选择后只会载入编辑框，点击保存并发布才会重新使用这一版。" :ui="{ content: 'max-w-3xl' }">
    <template #body>
      <div v-if="workspace.versions.length" class="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
        <button
          v-for="version in workspace.versions"
          :key="version.id"
          type="button"
          data-learning-history-version
          class="w-full rounded-lg border border-default p-4 text-left transition-colors hover:bg-elevated"
          :class="{ 'border-primary bg-primary/5': editor.baseVersionId === version.id }"
          @click="selectHistoryVersion(version)"
        >
          <span class="flex items-center justify-between gap-3">
            <span class="font-medium text-highlighted">版本 {{ version.versionNo }} · {{ formatTime(version.publishedAt) }}</span>
            <UBadge :color="version.id === workspace.activeVersion?.id ? 'primary' : 'neutral'" variant="subtle">
              {{ version.id === workspace.activeVersion?.id ? '正在使用' : '历史版本' }}
            </UBadge>
          </span>
          <span class="mt-1 block text-xs text-muted">{{ version.changeSummary }}</span>
          <span class="mt-2 block line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted">{{ version.promptText }}</span>
        </button>
      </div>
      <p v-else class="text-sm text-muted">还没有发布过提示词。</p>
    </template>
  </UModal>
</template>
