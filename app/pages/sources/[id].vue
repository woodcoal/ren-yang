<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, shallowRef } from 'vue'
import {
  createSourceLinkSchema,
  type CreateSourceLinkInput,
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
const initial = data.value?.data.source
const editState = reactive<UpdateSourceInput>({
  name: initial?.name ?? '',
  role: initial?.role ?? 'reference',
  content: initial?.contentText ?? '',
})
const linkState = reactive<CreateSourceLinkInput>({ targetType: 'persona', targetId: '', priority: 100 })
const actionLoading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)
const deletionImpact = shallowRef<DeletionImpact | null>(null)
const deletionConfirmed = shallowRef(false)

/** 根据关联类型返回可选目标。 */
const linkTargets = computed(() => linkState.targetType === 'persona'
  ? personas.value.map(item => ({ id: item.id, name: item.name }))
  : worlds.value.map(item => ({ id: item.id, name: item.name })))

/**
 * 保存资料元数据和正文，正文变化时服务端重建切片。
 * @param event 已通过共享 Schema 校验的资料输入。
 * @returns 请求完成时结束。
 */
async function saveSource(event: FormSubmitEvent<UpdateSourceInput>): Promise<void> {
  await runAction('资料与检索切片已更新', async () => {
    await $fetch(`/api/v1/sources/${sourceId}`, { method: 'PATCH', body: event.data })
    await refresh()
  })
}

/**
 * 建立或更新资料与目标聚合的关联。
 * @param event 已校验的目标与优先级。
 * @returns 请求完成时结束。
 */
async function createLink(event: FormSubmitEvent<CreateSourceLinkInput>): Promise<void> {
  await runAction('资料关联已保存', async () => {
    await $fetch(`/api/v1/sources/${sourceId}/links`, { method: 'POST', body: event.data })
    await refresh()
  })
}

/**
 * 解除一项资料关联，不删除人物、世界或资料。
 * @param linkId API 返回的复合关联标识。
 * @returns 请求完成时结束。
 */
async function removeLink(linkId: string): Promise<void> {
  await runAction('资料关联已解除', async () => {
    await $fetch(`/api/v1/sources/${sourceId}/links/${encodeURIComponent(linkId)}`, { method: 'DELETE' })
    await refresh()
  })
}

/** @returns 删除影响查询完成时结束。 */
async function inspectDeletion(): Promise<void> {
  await runAction(null, async () => {
    const response = await $fetch<ApiResponse<DeletionImpact>>(`/api/v1/sources/${sourceId}/deletion-impact`)
    deletionImpact.value = response.data
    deletionConfirmed.value = false
  })
}

/** @returns 永久删除和导航完成时结束。 */
async function deleteSource(): Promise<void> {
  if (!deletionConfirmed.value || !deletionImpact.value?.canDelete) return
  await runAction(null, async () => {
    await $fetch(`/api/v1/sources/${sourceId}`, { method: 'DELETE' })
    await navigateTo('/sources')
  })
}

/** @param successMessage 成功消息或 null。 @param action 异步操作。 @returns 操作结束时完成。 */
async function runAction(successMessage: string | null, action: () => Promise<void>): Promise<void> {
  actionLoading.value = true
  actionError.value = null
  actionMessage.value = null
  try {
    await action()
    actionMessage.value = successMessage
  }
  catch (requestError: unknown) {
    actionError.value = getApiErrorMessage(requestError, '操作失败')
  }
  finally {
    actionLoading.value = false
  }
}
</script>

<template>
  <div>
    <ContentPageHeader :title="details?.source.name || '资料详情'" description="正文是 SQLite 事实源；页面只显示纯文本，不执行资料中的 HTML。">
      <UButton to="/sources" color="neutral" variant="ghost">返回列表</UButton>
    </ContentPageHeader>
    <UAlert v-if="error || !details" color="error" title="资料详情加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <template v-else>
      <UAlert v-if="actionError" class="mb-5" color="error" title="操作失败" :description="actionError" />
      <UAlert v-if="actionMessage" class="mb-5" color="success" title="操作完成" :description="actionMessage" />
      <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="space-y-6">
          <UCard>
            <template #header><div><h2 class="font-semibold text-highlighted">资料正文</h2><p class="mt-1 text-xs text-muted">SHA-256：{{ details.source.contentHash }}</p></div></template>
            <UAlert v-if="details.source.originalFilePath" class="mb-4" color="info" title="文件导入资料" description="修改正文后将转为粘贴文本，旧原始文件会被删除，避免正文与文件不一致。" />
            <UForm :schema="updateSourceSchema" :state="editState" class="space-y-4" @submit="saveSource">
              <div class="grid gap-4 md:grid-cols-2">
                <UFormField name="name" label="资料名称" required><UInput v-model="editState.name" class="w-full" /></UFormField>
                <UFormField name="role" label="资料角色" required><USelect v-model="editState.role" class="w-full" :items="[{ label: '原著事实', value: 'canon_fact' }, { label: '普通参考', value: 'reference' }, { label: '表达样例', value: 'style_sample' }]" /></UFormField>
              </div>
              <UFormField name="content" label="正文" required><UTextarea v-model="editState.content" class="w-full" :rows="14" autoresize /></UFormField>
              <UButton type="submit" :loading="actionLoading">保存并重建切片</UButton>
            </UForm>
          </UCard>

          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">检索切片（{{ details.chunks.length }}）</h2></template>
            <div class="space-y-3">
              <div v-for="chunk in details.chunks" :key="chunk.id" class="rounded-md border border-default p-3">
                <p class="text-xs font-medium text-primary">第 {{ chunk.ordinal + 1 }} 段 · {{ chunk.heading || '无标题' }}</p>
                <pre class="content-pre mt-2">{{ chunk.content }}</pre>
                <p class="mt-2 break-all text-xs text-muted">{{ chunk.contentHash }}</p>
              </div>
            </div>
          </UCard>
        </div>

        <div class="space-y-6">
          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">人物与世界关联</h2></template>
            <div v-if="details.links.length" class="mb-5 space-y-2">
              <div v-for="link in details.links" :key="link.id" class="flex items-center justify-between gap-2 rounded-md border border-default p-2">
                <div class="min-w-0"><p class="truncate text-sm font-medium">{{ link.targetName }}</p><p class="text-xs text-muted">{{ link.targetType === 'persona' ? '人物' : '世界' }} · 优先级 {{ link.priority }}</p></div>
                <UButton icon="i-lucide-unlink" aria-label="解除资料关联" color="error" variant="ghost" size="sm" :loading="actionLoading" @click="removeLink(link.id)" />
              </div>
            </div>
            <p v-else class="mb-5 text-sm text-muted">尚无关联。</p>
            <UForm :schema="createSourceLinkSchema" :state="linkState" class="space-y-3" @submit="createLink">
              <UFormField name="targetType" label="目标类型"><USelect v-model="linkState.targetType" class="w-full" :items="[{ label: '人物', value: 'persona' }, { label: '世界', value: 'world' }]" @update:model-value="linkState.targetId = ''" /></UFormField>
              <UFormField name="targetId" label="目标" required><select v-model="linkState.targetId" class="native-control"><option disabled value="">请选择</option><option v-for="target in linkTargets" :key="target.id" :value="target.id">{{ target.name }}</option></select></UFormField>
              <UFormField name="priority" label="优先级"><UInput v-model.number="linkState.priority" type="number" min="0" max="10000" class="w-full" /></UFormField>
              <UButton type="submit" color="neutral" variant="soft" :loading="actionLoading">保存关联</UButton>
            </UForm>
          </UCard>

          <UCard>
            <template #header><h2 class="font-semibold text-error">永久删除</h2></template>
            <UButton v-if="!deletionImpact" color="error" variant="soft" :loading="actionLoading" @click="inspectDeletion">查看删除影响</UButton>
            <div v-else class="space-y-3 text-sm">
              <UAlert v-if="!deletionImpact.canDelete" color="warning" title="当前不能删除" :description="deletionImpact.blockers.join('；')" />
              <template v-else>
                <p>将删除 {{ details.chunks.length }} 个切片<span v-if="deletionImpact.files.length">和原始文件 {{ deletionImpact.files.join('、') }}</span>。</p>
                <label class="flex items-start gap-2"><input v-model="deletionConfirmed" type="checkbox" class="mt-1"><span>我确认永久删除此资料。</span></label>
                <UButton color="error" :disabled="!deletionConfirmed" :loading="actionLoading" @click="deleteSource">永久删除资料</UButton>
              </template>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </div>
</template>
