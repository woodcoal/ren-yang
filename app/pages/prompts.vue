<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import type { FormSubmitEvent } from '@nuxt/ui'
import { saveAiPromptDraftSchema, type SaveAiPromptDraftInput } from '#shared/schemas/aiPrompt'
import type { ApiResponse } from '#shared/types/api'
import type { AiPromptVersionView, AiPromptWorkspaceView } from '#shared/types/aiPrompt'
import { getApiErrorMessage } from '../utils/apiError'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { data, error, status, refresh } = await useFetch<ApiResponse<AiPromptWorkspaceView[]>>('/api/v1/ai-prompts')
const prompts = computed(() => data.value?.data ?? [])
const categories = computed(() => [...new Set(prompts.value.map(prompt => prompt.category))])
const query = shallowRef('')
const category = shallowRef('全部')
const selectedCode = shallowRef(typeof route.query.code === 'string' ? route.query.code : '')
const pendingSelectionCode = shallowRef<string | null>(null)
const switchConfirmationOpen = shallowRef(false)
const publishConfirmationOpen = shallowRef(false)
const deleteConfirmationOpen = shallowRef(false)
const saving = shallowRef(false)
const publishing = shallowRef(false)
const deleting = shallowRef(false)
const actionError = shallowRef<string | null>(null)

/** 提示词编辑表单状态；输入控件始终使用字符串，图片提示词保存时再转换为空系统模板。 */
type AiPromptDraftFormState = Omit<SaveAiPromptDraftInput, 'systemPromptTemplate'> & {
  /** 文本模型使用的系统提示模板；图片模型保持空字符串。 */
  systemPromptTemplate: string
}

const form = reactive<AiPromptDraftFormState>({
  baseVersionId: null,
  systemPromptTemplate: '',
  userPromptTemplate: '',
  changeSummary: '',
})

const filteredPrompts = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase('zh-CN')
  return prompts.value.filter((prompt) => {
    const matchesCategory = category.value === '全部' || prompt.category === category.value
    const matchesKeyword = keyword.length === 0
      || `${prompt.name} ${prompt.code} ${prompt.description}`.toLocaleLowerCase('zh-CN').includes(keyword)
    return matchesCategory && matchesKeyword
  })
})
const selectedPrompt = computed(() => prompts.value.find(prompt => prompt.code === selectedCode.value) ?? prompts.value[0] ?? null)
const editorSource = computed(() => selectedPrompt.value?.draft ?? selectedPrompt.value?.activeVersion ?? null)
const publishedCount = computed(() => prompts.value.filter(prompt => prompt.activeVersion !== null).length)
const draftCount = computed(() => prompts.value.filter(prompt => prompt.draft !== null).length)
const historyCount = computed(() => prompts.value.reduce((total, prompt) => total + prompt.versions.length, 0))
const isDirty = computed(() => {
  const source = editorSource.value
  if (!selectedPrompt.value || !source) return false
  const sourceSummary = selectedPrompt.value.draft?.changeSummary ?? ''
  return form.baseVersionId !== selectedPrompt.value.activeVersion?.id
    || form.systemPromptTemplate !== (source.systemPromptTemplate ?? '')
    || form.userPromptTemplate !== source.userPromptTemplate
    || form.changeSummary !== sourceSummary
})

watch(selectedPrompt, (prompt) => {
  if (!prompt) return
  selectedCode.value = prompt.code
  resetForm(prompt)
}, { immediate: true })

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
  actionError.value = null
}

/**
 * 请求切换提示词；存在未保存修改时先要求确认。
 * @param code 目标提示词稳定编码。
 * @returns 无返回值。
 */
function requestSelection(code: string): void {
  if (code === selectedPrompt.value?.code) return
  if (isDirty.value) {
    pendingSelectionCode.value = code
    switchConfirmationOpen.value = true
    return
  }
  applySelection(code)
}

/**
 * 应用已确认的提示词选择并同步地址栏查询参数。
 * @param code 目标提示词稳定编码。
 * @returns 无返回值。
 */
function applySelection(code: string): void {
  selectedCode.value = code
  pendingSelectionCode.value = null
  switchConfirmationOpen.value = false
  void router.replace({ query: { ...route.query, code } })
}

/**
 * 丢弃当前未保存修改并完成等待中的提示词切换。
 * @returns 无返回值。
 */
function confirmSelection(): void {
  if (pendingSelectionCode.value) applySelection(pendingSelectionCode.value)
}

/**
 * 保存当前模板为不影响运行时的唯一草稿。
 * @param event Nuxt UI 已通过共享 Schema 校验的提交事件。
 * @returns 请求和列表刷新完成时结束。
 */
async function saveDraft(event: FormSubmitEvent<SaveAiPromptDraftInput>): Promise<void> {
  const prompt = selectedPrompt.value
  if (!prompt) return
  saving.value = true
  actionError.value = null
  try {
    await $fetch(`/api/v1/ai-prompts/${encodeURIComponent(prompt.code)}/draft`, {
      method: 'PUT',
      body: {
        ...event.data,
        systemPromptTemplate: prompt.kind === 'text' ? event.data.systemPromptTemplate : null,
      },
    })
    await refresh()
    toast.add({ title: '草稿已保存', description: '尚未影响任何新的 AI 操作。', color: 'success', icon: 'i-lucide-check' })
  }
  catch (requestError: unknown) {
    actionError.value = getApiErrorMessage(requestError, '提示词草稿保存失败')
  }
  finally {
    saving.value = false
  }
}

/**
 * 发布当前草稿为新不可变版本。
 * @returns 发布和列表刷新完成时结束。
 */
async function publishDraft(): Promise<void> {
  const prompt = selectedPrompt.value
  if (!prompt?.draft) return
  publishing.value = true
  actionError.value = null
  try {
    await $fetch(`/api/v1/ai-prompts/${encodeURIComponent(prompt.code)}/publish`, {
      method: 'POST',
      body: { expectedDraftUpdatedAt: prompt.draft.updatedAt },
    })
    publishConfirmationOpen.value = false
    await refresh()
    toast.add({ title: '新版本已发布', description: '之后创建的 AI 操作将使用该版本。', color: 'success', icon: 'i-lucide-rocket' })
  }
  catch (requestError: unknown) {
    actionError.value = getApiErrorMessage(requestError, '提示词发布失败')
    publishConfirmationOpen.value = false
  }
  finally {
    publishing.value = false
  }
}

/**
 * 删除当前尚未发布的草稿，不影响已发布版本。
 * @returns 删除和列表刷新完成时结束。
 */
async function deleteDraft(): Promise<void> {
  const prompt = selectedPrompt.value
  if (!prompt?.draft) return
  deleting.value = true
  actionError.value = null
  try {
    await $fetch(`/api/v1/ai-prompts/${encodeURIComponent(prompt.code)}/draft`, { method: 'DELETE' })
    deleteConfirmationOpen.value = false
    await refresh()
    toast.add({ title: '草稿已删除', description: '当前发布版本保持不变。', color: 'neutral', icon: 'i-lucide-trash-2' })
  }
  catch (requestError: unknown) {
    actionError.value = getApiErrorMessage(requestError, '提示词草稿删除失败')
    deleteConfirmationOpen.value = false
  }
  finally {
    deleting.value = false
  }
}

/**
 * 把一个历史版本复制到当前编辑器，作为基于当前发布版本的新草稿内容。
 * @param version 要参考的不可变历史版本。
 * @returns 无返回值。
 */
function loadHistoryVersion(version: AiPromptVersionView): void {
  form.baseVersionId = selectedPrompt.value?.activeVersion?.id ?? null
  form.systemPromptTemplate = version.systemPromptTemplate ?? ''
  form.userPromptTemplate = version.userPromptTemplate
  form.changeSummary = `基于 v${version.versionNo} 重新调整`
  window.scrollTo({ top: 0, behavior: 'smooth' })
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
  <div>
    <ContentPageHeader title="集中维护全站 AI 提示词" description="所有模型调用只读取这里已发布的版本；编辑先保存为草稿，确认发布后才影响之后创建的 AI 操作。" />

    <div class="status-strip page-status-strip" aria-label="提示词状态摘要">
      <div class="status-cell"><span class="status-kicker">固定提示词</span><strong class="status-value">{{ prompts.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">已经发布</span><strong class="status-value">{{ publishedCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">待发布草稿</span><strong class="status-value">{{ draftCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">历史版本</span><strong class="status-value">{{ historyCount }}</strong></div>
    </div>

    <UAlert v-if="error" class="mt-6" color="error" title="提示词加载失败" description="无法读取已发布版本时，不应继续维护提示词。" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <UAlert v-if="actionError" class="mt-6" color="error" title="操作失败" :description="actionError" />

    <div v-if="status === 'pending'" class="content-empty-state my-9"><div><strong>正在读取提示词目录</strong><p>加载固定定义、草稿和发布历史。</p></div></div>
    <div v-else-if="selectedPrompt" class="prompt-workspace py-9">
      <aside class="prompt-catalog" aria-label="提示词目录">
        <div class="prompt-catalog-toolbar">
          <UInput v-model="query" icon="i-lucide-search" placeholder="搜索名称、编码或用途" aria-label="搜索提示词" class="w-full" />
          <select v-model="category" class="native-control" aria-label="提示词分类">
            <option value="全部">全部分类</option>
            <option v-for="item in categories" :key="item" :value="item">{{ item }}</option>
          </select>
        </div>
        <div class="prompt-catalog-list">
          <button
            v-for="prompt in filteredPrompts"
            :key="prompt.code"
            type="button"
            class="prompt-catalog-item"
            :class="{ 'prompt-catalog-item--active': prompt.code === selectedPrompt.code }"
            :aria-current="prompt.code === selectedPrompt.code ? 'page' : undefined"
            @click="requestSelection(prompt.code)"
          >
            <span class="prompt-catalog-item-heading"><strong>{{ prompt.name }}</strong><UBadge v-if="prompt.draft" color="warning" variant="subtle" size="sm">有草稿</UBadge></span>
            <span>{{ prompt.category }} · v{{ prompt.activeVersion?.versionNo ?? '—' }}</span>
            <code>{{ prompt.code }}</code>
          </button>
          <p v-if="filteredPrompts.length === 0" class="p-5 text-sm text-muted">没有符合条件的提示词。</p>
        </div>
      </aside>

      <main class="min-w-0">
        <section class="archive-panel" aria-labelledby="prompt-editor-heading">
          <div class="section-heading">
            <div class="section-heading-copy">
              <p class="eyebrow">{{ selectedPrompt.category }} · {{ selectedPrompt.kind === 'text' ? '文本模型' : '图片模型' }}</p>
              <h2 id="prompt-editor-heading">{{ selectedPrompt.name }}</h2>
              <p>{{ selectedPrompt.description }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <UBadge color="success" variant="subtle">当前 v{{ selectedPrompt.activeVersion?.versionNo ?? '—' }}</UBadge>
              <UBadge v-if="selectedPrompt.draft" color="warning" variant="subtle">草稿未发布</UBadge>
            </div>
          </div>

          <div class="prompt-variable-contract" aria-label="模板变量">
            <strong>可用模板变量</strong>
            <p>变量由业务代码提供，必须保持双花括号写法；不能新增、删除或改名。</p>
            <dl>
              <div v-for="variable in selectedPrompt.variables" :key="variable.name">
                <dt><code v-text="`{{${variable.name}}}`" /></dt>
                <dd>{{ variable.label }}：{{ variable.description }}</dd>
              </div>
            </dl>
          </div>

          <UForm :schema="saveAiPromptDraftSchema" :state="form" class="mt-6 space-y-5" @submit="saveDraft">
            <UFormField v-if="selectedPrompt.kind === 'text'" name="systemPromptTemplate" label="系统提示模板" description="最高优先级的角色、边界、安全规则与输出协议。" required>
              <UTextarea v-model="form.systemPromptTemplate" :rows="14" autoresize :maxrows="32" class="w-full font-mono text-sm" />
            </UFormField>
            <UFormField name="userPromptTemplate" :label="selectedPrompt.kind === 'text' ? '用户提示模板' : '图片提示模板'" description="使用上方固定变量组织每次调用的业务数据。" required>
              <UTextarea v-model="form.userPromptTemplate" :rows="14" autoresize :maxrows="32" class="w-full font-mono text-sm" />
            </UFormField>
            <UFormField name="changeSummary" label="修改说明" description="说明本次调整的目的，发布后会进入不可变历史。" required>
              <UInput v-model="form.changeSummary" maxlength="500" class="w-full" placeholder="例如：明确资料冲突时的处理顺序" />
            </UFormField>
            <div class="prompt-editor-actions">
              <div class="flex flex-wrap gap-2">
                <UButton type="submit" icon="i-lucide-save" :loading="saving">保存草稿</UButton>
                <UButton v-if="selectedPrompt.draft" type="button" color="error" variant="ghost" icon="i-lucide-trash-2" @click="deleteConfirmationOpen = true">删除草稿</UButton>
              </div>
              <UButton
                type="button"
                color="success"
                icon="i-lucide-rocket"
                :disabled="!selectedPrompt.draft || isDirty"
                @click="publishConfirmationOpen = true"
              >发布新版本</UButton>
            </div>
            <p v-if="selectedPrompt.draft && isDirty" class="text-sm text-warning">编辑器还有未保存修改，请先保存草稿再发布。</p>
          </UForm>
        </section>

        <section class="content-section" aria-labelledby="prompt-history-heading">
          <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">发布历史</p><h2 id="prompt-history-heading">不可变版本记录</h2><p>旧任务继续使用创建时锁定的版本；历史版本可以复制到编辑器重新校准。</p></div></div>
          <div class="log-list">
            <article v-for="version in selectedPrompt.versions" :key="version.id" class="log-row">
              <span class="log-row-meta">v{{ version.versionNo }}<br>{{ formatTime(version.publishedAt) }}</span>
              <span class="log-row-main"><strong class="log-row-title">{{ version.changeSummary }}</strong><span class="log-row-description">{{ version.id }}</span></span>
              <span class="log-row-end"><UButton size="sm" variant="ghost" icon="i-lucide-copy" @click="loadHistoryVersion(version)">载入编辑</UButton></span>
            </article>
          </div>
        </section>
      </main>
    </div>

    <UModal v-model:open="switchConfirmationOpen" title="放弃未保存修改？" description="切换提示词会恢复当前草稿或已发布版本，编辑器里的未保存内容无法找回。">
      <template #footer><UButton variant="ghost" @click="switchConfirmationOpen = false">继续编辑</UButton><UButton color="warning" @click="confirmSelection">放弃并切换</UButton></template>
    </UModal>

    <UModal v-model:open="publishConfirmationOpen" title="确认发布提示词新版本" :description="`发布后，之后创建的“${selectedPrompt?.name ?? ''}”AI 操作会立即使用该版本；已经创建的任务不会变化。`">
      <div class="p-5"><p class="text-sm text-muted">发布版本：v{{ (selectedPrompt?.activeVersion?.versionNo ?? 0) + 1 }}</p><p class="mt-2 text-sm">{{ selectedPrompt?.draft?.changeSummary }}</p></div>
      <template #footer><UButton variant="ghost" @click="publishConfirmationOpen = false">取消</UButton><UButton color="success" icon="i-lucide-rocket" :loading="publishing" @click="publishDraft">确认发布</UButton></template>
    </UModal>

    <UModal v-model:open="deleteConfirmationOpen" title="删除未发布草稿" description="只删除当前草稿；已发布版本和历史任务不会变化。删除后无法恢复草稿内容。">
      <template #footer><UButton variant="ghost" @click="deleteConfirmationOpen = false">取消</UButton><UButton color="error" icon="i-lucide-trash-2" :loading="deleting" @click="deleteDraft">确认删除</UButton></template>
    </UModal>
  </div>
</template>

<style scoped>
.prompt-workspace {
  display: grid;
  grid-template-columns: minmax(17rem, 21rem) minmax(0, 1fr);
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

.prompt-catalog-toolbar {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border-bottom: 1px solid var(--app-border);
}

.prompt-catalog-list {
  max-height: min(65rem, calc(100vh - 13rem));
  overflow-y: auto;
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

@media (max-width: 70rem) {
  .prompt-workspace {
    grid-template-columns: 1fr;
  }

  .prompt-catalog {
    position: static;
  }

  .prompt-catalog-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: 24rem;
  }

  .prompt-catalog-item:nth-child(odd) {
    border-right: 1px solid var(--app-border);
  }
}

@media (max-width: 40rem) {
  .prompt-catalog-list,
  .prompt-variable-contract dl {
    grid-template-columns: 1fr;
  }

  .prompt-catalog-item:nth-child(odd) {
    border-right: 0;
  }

  .prompt-editor-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
