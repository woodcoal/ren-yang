<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import type { FormSubmitEvent } from '@nuxt/ui'
import { saveAiPromptDraftSchema, type SaveAiPromptDraftInput } from '#shared/schemas/aiPrompt'
import type { AiPromptVersionView, AiPromptWorkspaceView } from '#shared/types/aiPrompt'
import { getApiErrorMessage } from '../../utils/apiError'

const props = defineProps<{
  /** 当前编辑的固定提示词工作区。 */
  prompt: AiPromptWorkspaceView
}>()

const emit = defineEmits<{
  /** 草稿、发布版本或删除状态改变后，请求父组件刷新数据。 */
  changed: []
  /** 未保存状态变化时通知父组件，用于防止误切换提示词。 */
  dirtyChange: [dirty: boolean]
}>()

/** 提示词编辑表单；图片提示词仍使用空字符串承接文本控件。 */
type AiPromptDraftFormState = Omit<SaveAiPromptDraftInput, 'systemPromptTemplate'> & {
  /** 文本模型系统提示模板；图片模型保持为空。 */
  systemPromptTemplate: string
}

const form = reactive<AiPromptDraftFormState>({
  baseVersionId: null,
  systemPromptTemplate: '',
  userPromptTemplate: '',
  changeSummary: '',
})
const { notifySuccess, notifyError } = useOperationNotifications()
const publishConfirmationOpen = shallowRef(false)
const deleteConfirmationOpen = shallowRef(false)
const saving = shallowRef(false)
const publishing = shallowRef(false)
const deleting = shallowRef(false)
const editorSource = computed(() => props.prompt.draft ?? props.prompt.activeVersion)
const isDirty = computed(() => {
  const source = editorSource.value
  if (!source) return form.userPromptTemplate.length > 0 || form.changeSummary.length > 0
  const sourceSummary = props.prompt.draft?.changeSummary ?? ''
  return form.baseVersionId !== props.prompt.activeVersion?.id
    || form.systemPromptTemplate !== (source.systemPromptTemplate ?? '')
    || form.userPromptTemplate !== source.userPromptTemplate
    || form.changeSummary !== sourceSummary
})

watch(() => props.prompt, resetForm, { immediate: true })
watch(isDirty, notifyDirtyState, { immediate: true })

/**
 * 使用当前草稿或已发布版本重置编辑表单。
 * @param prompt 当前选中的提示词工作区。
 * @returns 无返回值。
 */
function resetForm(prompt: AiPromptWorkspaceView): void {
  const source = prompt.draft ?? prompt.activeVersion
  form.baseVersionId = prompt.activeVersion?.id ?? null
  form.systemPromptTemplate = source?.systemPromptTemplate ?? ''
  form.userPromptTemplate = source?.userPromptTemplate ?? ''
  form.changeSummary = prompt.draft?.changeSummary ?? ''
}

/**
 * 把当前未保存状态通知父组件。
 * @param dirty 当前编辑器是否存在未保存修改。
 * @returns 无返回值。
 */
function notifyDirtyState(dirty: boolean): void {
  emit('dirtyChange', dirty)
}

/**
 * 保存当前模板为不影响运行时的唯一草稿。
 * @param event Nuxt UI 已通过共享 Schema 校验的提交事件。
 * @returns 请求完成时结束。
 */
async function saveDraft(event: FormSubmitEvent<SaveAiPromptDraftInput>): Promise<void> {
  saving.value = true
  try {
    await $fetch(`/api/v1/ai-prompts/${encodeURIComponent(props.prompt.code)}/draft`, {
      method: 'PUT',
      body: {
        ...event.data,
        systemPromptTemplate: props.prompt.kind === 'text' ? event.data.systemPromptTemplate : null,
      },
    })
    emit('changed')
    notifySuccess('尚未影响任何新的 AI 操作。', '草稿已保存')
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, '提示词草稿保存失败'))
  }
  finally {
    saving.value = false
  }
}

/**
 * 发布当前草稿为新的不可变版本。
 * @returns 请求完成时结束。
 */
async function publishDraft(): Promise<void> {
  if (!props.prompt.draft) return
  publishing.value = true
  try {
    await $fetch(`/api/v1/ai-prompts/${encodeURIComponent(props.prompt.code)}/publish`, {
      method: 'POST',
      body: { expectedDraftUpdatedAt: props.prompt.draft.updatedAt },
    })
    publishConfirmationOpen.value = false
    emit('changed')
    notifySuccess('之后创建的 AI 操作将使用该版本。', '新版本已发布')
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, '提示词发布失败'))
    publishConfirmationOpen.value = false
  }
  finally {
    publishing.value = false
  }
}

/**
 * 删除当前尚未发布的草稿，不影响已发布版本。
 * @returns 请求完成时结束。
 */
async function deleteDraft(): Promise<void> {
  if (!props.prompt.draft) return
  deleting.value = true
  try {
    await $fetch(`/api/v1/ai-prompts/${encodeURIComponent(props.prompt.code)}/draft`, { method: 'DELETE' })
    deleteConfirmationOpen.value = false
    emit('changed')
    notifySuccess('当前发布版本保持不变。', '草稿已删除')
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, '提示词草稿删除失败'))
    deleteConfirmationOpen.value = false
  }
  finally {
    deleting.value = false
  }
}

/**
 * 把历史版本复制到当前编辑器中，作为新草稿的起点。
 * @param version 要参考的不可变历史版本。
 * @returns 无返回值。
 */
function loadHistoryVersion(version: AiPromptVersionView): void {
  form.baseVersionId = props.prompt.activeVersion?.id ?? null
  form.systemPromptTemplate = version.systemPromptTemplate ?? ''
  form.userPromptTemplate = version.userPromptTemplate
  form.changeSummary = `基于 v${version.versionNo} 重新调整`
}

/**
 * 把 UTC Unix 毫秒转换为当前浏览器的中文日期时间。
 * @param timestamp UTC Unix 毫秒。
 * @returns 本地化日期时间。
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div class="space-y-5" data-ai-prompt-editor :data-prompt-code="prompt.code">
    <section class="archive-panel" :aria-labelledby="`prompt-editor-${prompt.code}`">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">{{ prompt.category }} · {{ prompt.kind === 'text' ? '文本模型' : '图片模型' }}</p>
          <h2 :id="`prompt-editor-${prompt.code}`">{{ prompt.name }}</h2>
          <p>{{ prompt.description }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <UBadge color="success" variant="subtle">当前 v{{ prompt.activeVersion?.versionNo ?? '—' }}</UBadge>
          <UBadge v-if="prompt.draft" color="warning" variant="subtle">草稿未发布</UBadge>
        </div>
      </div>

      <div class="prompt-variable-contract" aria-label="模板变量">
        <strong>可用模板变量</strong>
        <p>变量由业务代码提供，必须保持双花括号写法；不能新增、删除或改名。</p>
        <dl>
          <div v-for="variable in prompt.variables" :key="variable.name">
            <dt><code v-text="`{{${variable.name}}}`" /></dt>
            <dd>{{ variable.label }}：{{ variable.description }}</dd>
          </div>
        </dl>
      </div>

      <UForm :schema="saveAiPromptDraftSchema" :state="form" class="mt-6 space-y-5" @submit="saveDraft">
        <UFormField v-if="prompt.kind === 'text'" name="systemPromptTemplate" label="系统提示模板" description="最高优先级的角色、边界、安全规则与输出协议。" required>
          <UTextarea v-model="form.systemPromptTemplate" :rows="12" autoresize :maxrows="32" class="w-full font-mono text-sm" />
        </UFormField>
        <UFormField name="userPromptTemplate" :label="prompt.kind === 'text' ? '用户提示模板' : '图片提示模板'" description="使用上方固定变量组织每次调用的业务数据。" required>
          <UTextarea v-model="form.userPromptTemplate" :rows="12" autoresize :maxrows="32" class="w-full font-mono text-sm" />
        </UFormField>
        <UFormField name="changeSummary" label="修改说明" description="说明本次调整的目的，发布后会进入不可变历史。" required>
          <UInput v-model="form.changeSummary" maxlength="500" class="w-full" placeholder="例如：明确资料冲突时的处理顺序" />
        </UFormField>
        <div class="prompt-editor-actions">
          <div class="flex flex-wrap gap-2">
            <UButton type="submit" icon="i-lucide-save" :loading="saving">保存草稿</UButton>
            <UButton v-if="prompt.draft" type="button" color="error" variant="ghost" icon="i-lucide-trash-2" @click="deleteConfirmationOpen = true">删除草稿</UButton>
          </div>
          <UButton type="button" color="success" icon="i-lucide-rocket" :disabled="!prompt.draft || isDirty" @click="publishConfirmationOpen = true">发布新版本</UButton>
        </div>
        <p v-if="prompt.draft && isDirty" class="text-sm text-warning">编辑器还有未保存修改，请先保存草稿再发布。</p>
      </UForm>
    </section>

    <section class="content-section" :aria-labelledby="`prompt-history-${prompt.code}`">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">发布历史</p>
          <h2 :id="`prompt-history-${prompt.code}`">不可变版本记录</h2>
          <p>旧任务继续使用创建时锁定的版本；历史版本可复制回编辑器重新校准。</p>
        </div>
      </div>
      <div v-if="prompt.versions.length" class="log-list">
        <article v-for="version in prompt.versions" :key="version.id" class="log-row">
          <span class="log-row-meta">v{{ version.versionNo }}<br>{{ formatTime(version.publishedAt) }}</span>
          <span class="log-row-main"><strong class="log-row-title">{{ version.changeSummary }}</strong><span class="log-row-description">{{ version.id }}</span></span>
          <span class="log-row-end"><UButton size="sm" variant="ghost" icon="i-lucide-copy" @click="loadHistoryVersion(version)">载入编辑</UButton></span>
        </article>
      </div>
      <div v-else class="content-empty-state"><div><strong>暂无发布历史</strong><p>首次发布后会在这里保留版本。</p></div></div>
    </section>

    <UModal v-model:open="publishConfirmationOpen" title="确认发布提示词新版本" :description="`发布后，之后创建的“${prompt.name}”AI 操作会立即使用该版本；已经创建的任务不会变化。`">
      <div class="p-5"><p class="text-sm text-muted">发布版本：v{{ (prompt.activeVersion?.versionNo ?? 0) + 1 }}</p><p class="mt-2 text-sm">{{ prompt.draft?.changeSummary }}</p></div>
      <template #footer><UButton variant="ghost" @click="publishConfirmationOpen = false">取消</UButton><UButton color="success" icon="i-lucide-rocket" :loading="publishing" @click="publishDraft">确认发布</UButton></template>
    </UModal>

    <UModal v-model:open="deleteConfirmationOpen" title="删除未发布草稿" description="只删除当前草稿；已发布版本和历史任务不会变化。删除后无法恢复草稿内容。">
      <template #footer><UButton variant="ghost" @click="deleteConfirmationOpen = false">取消</UButton><UButton color="error" icon="i-lucide-trash-2" :loading="deleting" @click="deleteDraft">确认删除</UButton></template>
    </UModal>
  </div>
</template>

<style scoped>
.prompt-variable-contract {
  padding: 1rem;
  border-left: 3px solid var(--app-accent);
  background: var(--app-surface-soft);
}

.prompt-variable-contract > p {
  margin: 0.25rem 0 0;
  font-size: 0.8125rem;
}

.prompt-variable-contract dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem 1rem;
  margin-top: 1rem;
}

.prompt-variable-contract dl > div {
  min-width: 0;
}

.prompt-variable-contract dt {
  color: var(--app-accent-strong);
  font-size: 0.8125rem;
}

.prompt-variable-contract dd {
  margin: 0.2rem 0 0;
  color: var(--app-muted);
  font-size: 0.75rem;
}

.prompt-editor-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--app-border);
}

@media (max-width: 40rem) {
  .prompt-variable-contract dl {
    grid-template-columns: 1fr;
  }

  .prompt-editor-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
