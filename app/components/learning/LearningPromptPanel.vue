<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import type { LearningPromptVersionView, LearningPromptWorkspaceView } from '#shared/types/learning'

const props = defineProps<{
  /** 当前学习提示词的草稿、已发布版本和历史。 */
  workspace: LearningPromptWorkspaceView
  /** 页面级动作是否正在执行。 */
  loading: boolean
  /** 展示标题，例如“人物成长”或“人物记忆”。 */
  title: string
}>()

const emit = defineEmits<{
  /** 保存不会立即生效的完整提示词草稿。 */
  save: [input: { promptText: string, baseVersionId: string | null }]
  /** 删除当前未发布草稿。 */
  deleteDraft: []
  /** 发布草稿并使其进入之后创建的新任务。 */
  publish: [input: { changeSummary: string }]
  /** 基于指定历史版本覆盖创建当前草稿。 */
  draftFromVersion: [input: { versionId: string }]
}>()

const form = reactive({ promptText: '', changeSummary: '发布校准后的提示词' })
const deleteConfirmationOpen = shallowRef(false)
const rollbackConfirmationOpen = shallowRef(false)
const rollbackVersion = shallowRef<LearningPromptVersionView | null>(null)
const currentVersionLabel = computed(() => props.workspace.activeVersion
  ? `版本 ${props.workspace.activeVersion.versionNo}`
  : '尚未发布')

/**
 * 使用服务端当前草稿初始化编辑器；无草稿时复制当前已发布正文作为校准起点。
 * @returns 编辑表单同步完成时结束。
 */
function syncEditor(): void {
  form.promptText = props.workspace.draft?.promptText ?? props.workspace.activeVersion?.promptText ?? ''
}

/**
 * 保存完整提示词草稿，但不改变当前已发布版本。
 * @returns 表单有效时发出保存命令，否则直接结束。
 */
function saveDraft(): void {
  const promptText = form.promptText.trim()
  if (!promptText) return
  emit('save', {
    promptText,
    baseVersionId: props.workspace.draft?.baseVersionId ?? props.workspace.activeVersion?.id ?? null,
  })
}

/**
 * 发布当前服务端草稿并附带人工变更说明。
 * @returns 草稿存在且说明有效时发出发布命令，否则直接结束。
 */
function publishDraft(): void {
  const changeSummary = form.changeSummary.trim()
  if (!props.workspace.draft || !changeSummary) return
  emit('publish', { changeSummary })
}

/**
 * 打开历史版本恢复确认框，避免意外覆盖尚未发布草稿。
 * @param version 需要复制为新草稿的已发布版本。
 * @returns 恢复目标保存且确认框打开时结束。
 */
function requestDraftFromVersion(version: LearningPromptVersionView): void {
  rollbackVersion.value = version
  rollbackConfirmationOpen.value = true
}

/**
 * 确认把指定历史版本复制成当前可编辑草稿。
 * @returns 复制命令发出且确认框关闭后结束。
 */
function confirmDraftFromVersion(): void {
  if (!rollbackVersion.value) return
  emit('draftFromVersion', { versionId: rollbackVersion.value.id })
  rollbackConfirmationOpen.value = false
}

/**
 * 确认删除当前未发布草稿，保留全部已发布版本。
 * @returns 删除命令发出且确认框关闭后结束。
 */
function confirmDeleteDraft(): void {
  if (!props.workspace.draft) return
  emit('deleteDraft')
  deleteConfirmationOpen.value = false
}

// 仅在服务端草稿或当前版本变化时重新同步，分析完成后能立即显示新草稿。
watch(
  () => [props.workspace.draft?.id, props.workspace.draft?.updatedAt, props.workspace.activeVersion?.id],
  syncEditor,
  { immediate: true },
)
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="font-semibold text-highlighted">{{ title }}提示词</h2>
          <p class="mt-1 text-sm text-muted">只有已发布版本会固定进入之后创建的新任务；草稿可先人工校准。</p>
        </div>
        <UBadge :color="workspace.activeVersion ? 'success' : 'neutral'" variant="soft">当前：{{ currentVersionLabel }}</UBadge>
      </div>
    </template>

    <section>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-highlighted">当前已发布提示词</h3>
        <span v-if="workspace.activeVersion" class="text-xs text-muted">{{ workspace.activeVersion.changeSummary }}</span>
      </div>
      <p v-if="workspace.activeVersion" class="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-default bg-muted/20 p-4 text-sm leading-6 text-muted">{{ workspace.activeVersion.promptText }}</p>
      <UAlert v-else class="mt-3" color="neutral" title="尚无生效提示词" description="先从素材提炼或手工编写草稿，人工校准并发布后才会进入新任务。" />
    </section>

    <section class="mt-6 border-t border-default pt-6">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="text-sm font-semibold text-highlighted">校准草稿</h3>
          <p class="mt-1 text-xs text-muted">{{ workspace.draft ? `已有${workspace.draft.createdBy === 'analysis' ? ' AI 提炼' : '人工'}草稿，尚未生效。` : '当前没有已保存草稿；可直接开始手工校准。' }}</p>
        </div>
        <UButton v-if="workspace.draft" color="error" variant="ghost" size="xs" :disabled="loading" @click="deleteConfirmationOpen = true">删除草稿</UButton>
      </div>
      <UTextarea v-model="form.promptText" data-learning-prompt-editor class="mt-3 w-full" :rows="12" autoresize :maxrows="24" maxlength="20000" :disabled="loading" placeholder="输入完整提示词，或先让 AI 从启用素材中综合提炼。" />
      <div class="mt-3 flex flex-wrap items-end justify-between gap-3">
        <p class="text-xs text-muted">保存草稿不会生效；发布时会校验对应提示词 Token 预算。</p>
        <div class="flex flex-wrap gap-2">
          <UButton color="neutral" variant="soft" :loading="loading" :disabled="!form.promptText.trim()" @click="saveDraft">保存草稿</UButton>
        </div>
      </div>

      <div v-if="workspace.draft" class="mt-5 rounded-lg border border-default p-4">
        <UFormField label="发布说明" description="会写入不可变版本历史。">
          <UInput v-model="form.changeSummary" class="w-full" maxlength="200" :disabled="loading" />
        </UFormField>
        <div class="mt-3 flex justify-end">
          <UButton icon="i-lucide-send" :loading="loading" :disabled="!form.changeSummary.trim()" @click="publishDraft">发布并用于新任务</UButton>
        </div>
      </div>
    </section>

    <section v-if="workspace.versions.length" class="mt-6 border-t border-default pt-6">
      <h3 class="text-sm font-semibold text-highlighted">发布历史</h3>
      <div class="mt-3 learning-list">
        <article v-for="version in workspace.versions" :key="version.id" class="learning-row">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <strong class="text-sm text-highlighted">版本 {{ version.versionNo }}</strong>
              <UBadge v-if="workspace.activeVersion?.id === version.id" color="success" variant="soft">当前使用</UBadge>
              <span class="text-xs text-muted">{{ new Date(version.publishedAt).toLocaleString('zh-CN') }}</span>
            </div>
            <p class="mt-1 text-sm text-muted">{{ version.changeSummary }}</p>
            <details class="mt-2 text-sm text-muted">
              <summary class="cursor-pointer text-primary">查看版本正文</summary>
              <p class="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap leading-6">{{ version.promptText }}</p>
            </details>
          </div>
          <UButton color="neutral" variant="ghost" size="xs" :disabled="loading" @click="requestDraftFromVersion(version)">基于此版本校准</UButton>
        </article>
      </div>
    </section>
  </UCard>

  <UModal v-model:open="deleteConfirmationOpen" title="确认删除草稿" description="删除后仍保留当前已发布提示词和全部版本历史。" :dismissible="!loading" :close="!loading">
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :disabled="loading" @click="deleteConfirmationOpen = false">取消</UButton>
        <UButton color="error" :loading="loading" @click="confirmDeleteDraft">确认删除草稿</UButton>
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="rollbackConfirmationOpen"
    :title="`基于版本 ${rollbackVersion?.versionNo ?? ''} 创建草稿`"
    description="这会用所选历史版本覆盖当前未发布草稿；已发布提示词不会立即改变。"
    :dismissible="!loading"
    :close="!loading"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :disabled="loading" @click="rollbackConfirmationOpen = false">取消</UButton>
        <UButton :loading="loading" @click="confirmDraftFromVersion">创建校准草稿</UButton>
      </div>
    </template>
  </UModal>
</template>
