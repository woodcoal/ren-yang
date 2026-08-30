<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, shallowRef, watch } from 'vue'
import { saveSoulVersionSchema, type SaveSoulVersionInput } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { SoulSnapshot, SoulVersionView, SoulWorkspaceView } from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

/** 灵魂编辑工作区属性。 */
interface Props {
  /** 世界或人物当前灵魂及全部保存历史。 */
  workspace: SoulWorkspaceView
  /** 页面是否正在保存灵魂版本。 */
  loading: boolean
}

const props = defineProps<Props>()
const { runWithAiLoading } = useAiLoading()

const emit = defineEmits<{
  /** 保存编辑框内容并立即生成新的当前版本。 */
  save: [input: SaveSoulVersionInput]
}>()

/** 直接显示在页面中的灵魂编辑状态。 */
const editor = reactive<SaveSoulVersionInput>({
  baseVersionId: props.workspace.activeVersion?.id ?? null,
  snapshot: { promptText: props.workspace.activeVersion?.snapshot.promptText ?? '' },
})
/** 是否显示全部提示词历史记录。 */
const historyOpen = shallowRef(false)
/** AI 是否正在整理当前编辑文本。 */
const analysisLoading = shallowRef(false)
/** AI 整理失败后的通俗错误信息。 */
const analysisError = shallowRef<string | null>(null)
/** 编辑区灵魂文本的保守 Token 估算，仅用于即时提示。 */
const estimatedTokens = computed(() => Math.ceil(new TextEncoder().encode(editor.snapshot.promptText).length / 3))
/** 当前对象的通俗中文名称。 */
const subjectLabel = computed(() => props.workspace.subjectType === 'world' ? '世界' : '人物')
/** 当前编辑内容相对正在使用版本是否发生变化。 */
const hasChanges = computed(() => {
  const active = props.workspace.activeVersion
  if (!active) return editor.snapshot.promptText.trim().length > 0
  return editor.baseVersionId !== active.id || editor.snapshot.promptText.trim() !== active.snapshot.promptText
})

/**
 * 使用最新生效版本同步编辑器；保存失败时版本标识不变，因此不会覆盖用户输入。
 * @param version 服务端返回的当前灵魂版本；尚无版本时为 null。
 * @param previousVersion 同一属性上一次的灵魂版本；首次同步时为 undefined。
 * @returns 无返回值。
 */
function synchronizeActiveVersion(version: SoulVersionView | null, previousVersion?: SoulVersionView | null): void {
  if (!version || version.id === previousVersion?.id) return
  editor.baseVersionId = version.id
  editor.snapshot.promptText = version.snapshot.promptText
  analysisError.value = null
}

/**
 * 将指定历史版本载入编辑框，不立即改变正在使用的版本。
 * @param version 用户选择的不可变提示词历史版本。
 * @returns 无返回值。
 */
function selectHistoryVersion(version: SoulVersionView): void {
  editor.baseVersionId = version.id
  editor.snapshot.promptText = version.snapshot.promptText
  analysisError.value = null
  historyOpen.value = false
}

/**
 * 使用 AI 整理当前编辑框提示词，只回填结果而不自动保存。
 * @returns 模型请求结束并更新编辑状态时完成。
 */
async function analyzePrompt(): Promise<void> {
  if (!editor.snapshot.promptText.trim() || analysisLoading.value || props.loading) return
  analysisLoading.value = true
  analysisError.value = null
  try {
    const response = await runWithAiLoading({
      title: `AI 正在整理${subjectLabel.value}灵魂`,
      description: '模型正在分析原始提示词并整理表达、边界与行为规则，可能需要几十秒。',
      completionHint: '完成后结果会回填编辑框，请检查内容并点击保存。',
    }, async () => await $fetch<ApiResponse<SoulSnapshot>>('/api/v1/soul/analyze', {
      method: 'POST',
      body: { subjectType: props.workspace.subjectType, promptText: editor.snapshot.promptText },
    }))
    editor.snapshot.promptText = response.data.promptText
  }
  catch (requestError: unknown) {
    analysisError.value = getApiErrorMessage(requestError, 'AI 整理灵魂提示词失败')
  }
  finally {
    analysisLoading.value = false
  }
}

/**
 * 上送已经通过共享 Schema 校验的灵魂版本输入。
 * @param event Nuxt UI 表单提交事件。
 * @returns 无返回值。
 */
function handleSave(event: FormSubmitEvent<SaveSoulVersionInput>): void {
  emit('save', event.data)
}

/**
 * 格式化提示词历史保存时间。
 * @param timestamp UTC Unix 毫秒。
 * @returns 本地中文时间。
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

watch(() => props.workspace.activeVersion, synchronizeActiveVersion, { immediate: true })
</script>

<template>
  <div>
    <UCard>
      <template #header>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="font-semibold text-highlighted">{{ subjectLabel }}灵魂提示词</h2>
            <p class="mt-1 text-sm text-muted">AI 整理和历史只会回填编辑框；检查并保存发布后，才会用于后续新任务。</p>
          </div>
          <UBadge :color="workspace.activeVersion ? 'success' : 'neutral'" variant="soft">
            {{ workspace.activeVersion ? '当前提示词已发布' : '尚未发布' }}
          </UBadge>
        </div>
      </template>

      <UForm :schema="saveSoulVersionSchema" :state="editor" class="space-y-4" data-soul-prompt-form @submit="handleSave">
        <UFormField
          name="snapshot.promptText"
          :label="`${subjectLabel}灵魂提示词`"
          description="可直接手工校准完整提示词；发布时会自动保留上一版历史。"
          required
        >
          <UTextarea
            v-model="editor.snapshot.promptText"
            class="w-full"
            :rows="20"
            autoresize
            :maxrows="32"
            :disabled="loading || analysisLoading"
            placeholder="输入人物核心人设，或世界背景、规则与边界……"
          />
        </UFormField>

        <UAlert v-if="analysisError" color="error" title="AI 整理失败" :description="analysisError" />

        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-1">
            <UButton
              type="button"
              data-soul-analyze-button
              icon="i-lucide-wand-sparkles"
              color="neutral"
              variant="ghost"
              aria-label="AI 整理当前提示词"
              title="AI 整理当前提示词"
              :disabled="!editor.snapshot.promptText.trim() || loading || analysisLoading"
              @click="analyzePrompt"
            />
            <UButton
              type="button"
              data-soul-history-button
              icon="i-lucide-history"
              color="neutral"
              variant="ghost"
              aria-label="查看提示词历史"
              title="查看提示词历史"
              :disabled="loading || analysisLoading"
              @click="historyOpen = true"
            />
            <span class="ml-2 text-xs text-muted">预计 {{ estimatedTokens }} Token</span>
          </div>
          <UButton
            type="submit"
            data-soul-save-publish-button
            icon="i-lucide-send"
            :loading="loading"
            :disabled="!hasChanges || analysisLoading"
          >保存并发布</UButton>
        </div>
      </UForm>
    </UCard>

    <UModal v-model:open="historyOpen" title="提示词历史" description="选择后只会载入编辑框，点击保存并发布才会重新使用这一版。" :ui="{ content: 'max-w-3xl' }">
      <template #body>
        <div v-if="workspace.versions.length" class="max-h-[65vh] space-y-2 overflow-y-auto pr-1" data-soul-history-list>
          <button
            v-for="version in workspace.versions"
            :key="version.id"
            type="button"
            class="w-full rounded-lg border border-default p-4 text-left transition-colors hover:bg-elevated"
            :class="{ 'border-primary bg-primary/5': editor.baseVersionId === version.id }"
            @click="selectHistoryVersion(version)"
          >
            <span class="flex items-center justify-between gap-3">
              <span class="font-medium text-highlighted">{{ formatTime(version.publishedAt) }}</span>
              <UBadge :color="version.id === workspace.activeVersion?.id ? 'primary' : 'neutral'" variant="subtle">
                {{ version.id === workspace.activeVersion?.id ? '正在使用' : '历史版本' }}
              </UBadge>
            </span>
            <span class="mt-2 block line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted">{{ version.snapshot.promptText }}</span>
          </button>
        </div>
        <p v-else class="text-sm text-muted">还没有保存过提示词。</p>
      </template>
    </UModal>
  </div>
</template>
