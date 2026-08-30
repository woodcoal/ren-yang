<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import {
  type SourceCreationTarget,
  updateSourceSchema,
  type UpdateSourceInput,
} from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { DeletionImpact, PersonaSummary, SourceDetails, WorldSummary } from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

const sourceId = String(useRoute().params.id)
const [{ data, error, refresh }, { data: personaData }, { data: worldData }] = await Promise.all([
  useFetch<ApiResponse<SourceDetails>>(`/api/v1/sources/${sourceId}`),
  useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas'),
  useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds'),
])
const details = computed(() => data.value?.data ?? null)
const personas = computed(() => personaData.value?.data ?? [])
const worlds = computed(() => worldData.value?.data ?? [])
const selectedTab = shallowRef<'body' | 'chunks' | 'relations' | 'operations'>('body')
const editState = reactive<UpdateSourceInput>({
  name: '',
  role: 'reference',
  content: '',
})
const relationTargets = ref<SourceCreationTarget[]>([])
const actionLoading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)
const deletionImpact = shallowRef<DeletionImpact | null>(null)
const enableConfirmationOpen = shallowRef(false)
const disableConfirmationOpen = shallowRef(false)
/** 是否已用首次成功加载的资料初始化编辑表单。 */
const editStateInitialized = shallowRef(false)

/**
 * 首次成功加载资料后初始化编辑表单，失败重试成功时同样生效。
 * @param current 当前资料详情；请求尚未成功时为 null。
 * @returns 表单已初始化或没有可用详情时结束。
 */
function initializeEditState(current: SourceDetails | null): void {
  if (!current || editStateInitialized.value) return
  editState.name = current.source.name
  editState.role = current.source.role
  editState.content = current.source.contentText
  editStateInitialized.value = true
}

watch(details, initializeEditState, { immediate: true })

/**
 * 把服务端关系转换为标签选择器使用的目标集合。
 * @param current 当前资料详情；请求尚未成功时为 null。
 * @returns 关系标签已同步或没有可用详情时结束。
 */
function synchronizeRelationTargets(current: SourceDetails | null): void {
  if (!current) return
  relationTargets.value = current.links.map(link => ({
    targetType: link.targetType,
    targetId: link.targetId,
  }))
}

watch(details, synchronizeRelationTargets, { immediate: true })

/**
 * 生成关系差异比较使用的稳定复合值。
 * @param target 人物或世界关联目标。
 * @returns `类型:UUID` 格式的关系标识。
 */
function createTargetKey(target: SourceCreationTarget): string {
  return `${target.targetType}:${target.targetId}`
}

/**
 * 保存资料元数据和正文，正文变化时服务端重建切片。
 * @param event 已通过共享 Schema 校验的资料输入。
 * @returns 请求完成时结束。
 */
async function saveSource(event: FormSubmitEvent<UpdateSourceInput>): Promise<void> {
  await runAction('资料已更新，搜索内容已重新整理', async () => {
    await $fetch(`/api/v1/sources/${sourceId}`, { method: 'PATCH', body: event.data })
    await refresh()
  })
}

/**
 * 根据标签变化立即新增或解除关系，失败时恢复原选择。
 * @param nextTargets 用户修改后的全部目标。
 * @returns 关系请求和详情刷新完成时结束。
 */
async function updateRelationTargets(nextTargets: SourceCreationTarget[]): Promise<void> {
  if (actionLoading.value) return
  const previousTargets = relationTargets.value.map(target => ({ ...target }))
  const previousKeys = new Set(previousTargets.map(createTargetKey))
  const nextKeys = new Set(nextTargets.map(createTargetKey))
  const added = nextTargets.filter(target => !previousKeys.has(createTargetKey(target)))
  const removed = previousTargets.filter(target => !nextKeys.has(createTargetKey(target)))
  if (added.length === 0 && removed.length === 0) return

  relationTargets.value = nextTargets
  const succeeded = await runAction('资料使用关系已保存', async () => {
    for (const target of added) {
      await $fetch(`/api/v1/sources/${sourceId}/links`, {
        method: 'POST',
        body: { ...target, priority: 100 },
      })
    }
    for (const target of removed) {
      await $fetch(`/api/v1/sources/${sourceId}/links/${encodeURIComponent(createTargetKey(target))}`, { method: 'DELETE' })
    }
    await refresh()
  })
  if (!succeeded) relationTargets.value = previousTargets
}

/**
 * 写入资料全局启用状态，不删除正文和使用关系。
 * @param isEnabled 需要写入的新状态。
 * @returns 状态请求是否成功。
 */
async function updateSourceStatus(isEnabled: boolean): Promise<boolean> {
  return await runAction(isEnabled ? '资料已启用' : '资料已禁用', async () => {
    await $fetch(`/api/v1/sources/${sourceId}/status`, { method: 'PATCH', body: { isEnabled } })
    await refresh()
  })
}

/**
 * 根据资料当前状态打开启用或禁用二次确认框。
 * @returns 确认框打开时结束。
 */
async function requestSourceStatusChange(): Promise<void> {
  if (!details.value) return
  if (details.value.source.isEnabled) {
    disableConfirmationOpen.value = true
    return
  }
  enableConfirmationOpen.value = true
}

/**
 * 用户二次确认后启用当前资料。
 * @returns 启用请求完成时结束。
 */
async function confirmEnableSource(): Promise<void> {
  const succeeded = await updateSourceStatus(true)
  if (succeeded) enableConfirmationOpen.value = false
}

/**
 * 用户二次确认后禁用当前资料。
 * @returns 禁用请求完成时结束。
 */
async function confirmDisableSource(): Promise<void> {
  const succeeded = await updateSourceStatus(false)
  if (succeeded) disableConfirmationOpen.value = false
}

/** @returns 删除影响查询完成时结束。 */
async function inspectDeletion(): Promise<void> {
  await runAction(null, async () => {
    const response = await $fetch<ApiResponse<DeletionImpact>>(`/api/v1/sources/${sourceId}/deletion-impact`)
    deletionImpact.value = response.data
  })
}

/** @returns 永久删除和导航完成时结束。 */
async function deleteSource(): Promise<void> {
  if (!deletionImpact.value?.canDelete) return
  await runAction(null, async () => {
    await $fetch(`/api/v1/sources/${sourceId}`, { method: 'DELETE' })
    await navigateTo('/sources')
  })
}

/** @param successMessage 成功消息或 null。 @param action 异步操作。 @returns 操作是否成功完成。 */
async function runAction(successMessage: string | null, action: () => Promise<void>): Promise<boolean> {
  actionLoading.value = true
  actionError.value = null
  actionMessage.value = null
  try {
    await action()
    actionMessage.value = successMessage
    return true
  }
  catch (requestError: unknown) {
    actionError.value = getApiErrorMessage(requestError, '操作失败')
    return false
  }
  finally {
    actionLoading.value = false
  }
}
</script>

<template>
  <div>
    <ContentPageHeader :title="details?.source.name || '资料详情'" description="编辑资料正文、查看系统整理的段落，以及管理它被哪些人物或世界使用。">
      <UButton to="/sources" color="neutral" variant="ghost">返回列表</UButton>
    </ContentPageHeader>
    <UAlert
      v-if="error || !details"
      color="error"
      title="资料详情加载失败"
      :description="error ? getApiErrorMessage(error, '资料详情请求失败') : '服务端没有返回资料详情'"
      :actions="[{ label: '重试', onClick: () => refresh() }]"
    />
    <template v-else>
      <UAlert v-if="actionError" class="mb-5" color="error" title="操作失败" :description="actionError" />
      <UAlert v-if="actionMessage" class="mb-5" color="success" title="操作完成" :description="actionMessage" />
      <div class="status-strip page-status-strip mb-6">
        <div class="status-cell"><span class="status-kicker">AI 使用方式</span><strong class="status-value">{{ details.source.role === 'canon_fact' ? '确定事实' : details.source.role === 'style_sample' ? '风格参考' : '背景参考' }}</strong></div>
        <div class="status-cell"><span class="status-kicker">当前状态</span><strong class="status-value">{{ details.source.isEnabled ? '已启用' : '已禁用' }}</strong></div>
        <div class="status-cell"><span class="status-kicker">可检索段落</span><strong class="status-value">{{ details.chunks.length }}</strong></div>
        <div class="status-cell"><span class="status-kicker">使用关系</span><strong class="status-value">{{ details.links.length }}</strong></div>
      </div>
      <UAlert v-if="!details.source.isEnabled" class="mb-6" color="warning" title="资料当前已禁用" description="正文和使用关系仍保留，但不会进入人物或世界检索，也不会保留 OpenViking 投影。重新启用后会自动恢复。" />
      <nav class="mind-tabs mb-6" aria-label="资料详情标签">
        <button class="mind-tab" :aria-selected="selectedTab === 'body'" @click="selectedTab = 'body'">资料正文</button>
        <button class="mind-tab" :aria-selected="selectedTab === 'chunks'" @click="selectedTab = 'chunks'">可检索段落</button>
        <button class="mind-tab" :aria-selected="selectedTab === 'relations'" @click="selectedTab = 'relations'">使用关系</button>
        <button class="mind-tab" :aria-selected="selectedTab === 'operations'" @click="selectedTab = 'operations'">操作</button>
      </nav>
      <div class="space-y-6">
        <div class="contents">
          <UCard v-if="selectedTab === 'body'">
            <template #header><div><h2 class="font-semibold text-highlighted">资料正文</h2><p class="mt-1 text-sm text-muted">修改后，系统会自动重新整理可供 AI 查找的内容段落。</p></div></template>
            <UAlert v-if="details.source.originalFilePath" class="mb-4" color="info" title="文件导入资料" description="修改正文后将转为粘贴文本，旧原始文件会被删除，避免正文与文件不一致。" />
            <UForm :schema="updateSourceSchema" :state="editState" class="space-y-4" @submit="saveSource">
              <div class="grid gap-4 md:grid-cols-2">
                <UFormField name="name" label="资料名称" description="文件名或自定义名称，用于在列表中显示。" required><UInput v-model="editState.name" class="w-full" /></UFormField>
                <UFormField name="role" label="AI 使用方式" description="确定事实参与事实判断；背景参考补充上下文；风格参考只影响表达。" required><USelect v-model="editState.role" class="w-full" :items="[{ label: '原作中的确定事实', value: 'canon_fact' }, { label: '背景参考', value: 'reference' }, { label: '写作风格参考', value: 'style_sample' }]" /></UFormField>
              </div>
              <UAlert color="info" title="该选项会实际影响 AI" description="确定事实会作为高优先级事实证据；背景参考只补充上下文；风格样例只影响表达，不作为事实。" />
              <UFormField name="content" label="正文" required><UTextarea v-model="editState.content" class="w-full" :rows="14" autoresize /></UFormField>
              <UButton type="submit" :loading="actionLoading">保存资料</UButton>
            </UForm>
          </UCard>

          <UCard v-else-if="selectedTab === 'chunks'">
            <template #header><div><h2 class="font-semibold text-highlighted">系统整理的内容段落（{{ details.chunks.length }}）</h2><p class="mt-1 text-sm text-muted">AI 搜索资料时会按这些段落寻找相关内容，无需手工调整。</p></div></template>
            <div class="space-y-3">
              <div v-for="chunk in details.chunks" :key="chunk.id" class="rounded-md border border-default p-3">
                <p class="text-xs font-medium text-primary">第 {{ chunk.ordinal + 1 }} 段 · {{ chunk.heading || '无标题' }}</p>
                <pre class="content-pre mt-2">{{ chunk.content }}</pre>
              </div>
            </div>
          </UCard>
        </div>

        <div class="contents">
          <UCard v-if="selectedTab === 'relations'">
            <template #header><div><h2 class="font-semibold text-highlighted">这份资料用在哪里</h2><p class="mt-1 text-sm text-muted">关联后，对应人物或世界的新任务才能搜索到这份资料。</p></div></template>
            <ContentSourceTargetPicker
              :model-value="relationTargets"
              :personas="personas"
              :worlds="worlds"
              :disabled="actionLoading"
              show-selected-groups
              @update:model-value="updateRelationTargets"
            />
            <p class="mt-3 text-xs text-muted">添加或移除标签后立即保存；解除关系不会删除资料、人物或世界。</p>
          </UCard>

          <ContentLifecycleOperationsPanel
            v-else-if="selectedTab === 'operations'"
            subject-type="source"
            :subject-name="details.source.name"
            :is-enabled="details.source.isEnabled"
            :deletion-impact="deletionImpact"
            :loading="actionLoading"
            @request-status-change="requestSourceStatusChange"
            @inspect-deletion="inspectDeletion"
            @delete="deleteSource"
          />
        </div>
      </div>
    </template>

    <UModal v-model:open="enableConfirmationOpen" title="确认启用资料" description="启用后，它可以重新进入人物和世界检索。">
      <template #body>
        <p class="text-sm text-muted">确定启用“{{ details?.source.name }}”吗？系统会恢复对应 OpenViking 投影。</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="actionLoading" @click="enableConfirmationOpen = false">取消</UButton>
          <UButton color="success" :loading="actionLoading" @click="confirmEnableSource">确认启用</UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="disableConfirmationOpen" title="确认禁用资料" description="禁用不会删除正文、系统整理的段落或使用关系。">
      <template #body>
        <p class="text-sm text-muted">确定禁用“{{ details?.source.name }}”吗？禁用后它将停止进入人物和世界检索，并删除对应 OpenViking 投影。</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="actionLoading" @click="disableConfirmationOpen = false">取消</UButton>
          <UButton color="error" :loading="actionLoading" @click="confirmDisableSource">确认禁用</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
