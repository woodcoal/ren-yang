<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, shallowRef } from 'vue'
import {
  createWorldVersionSchema,
  type CreateWorldVersionInput,
  updateWorldSchema,
  type UpdateWorldInput,
} from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { DeletionImpact, VersionFieldDiff, WorldDetails } from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

const worldId = String(useRoute().params.id)
const { data, error, refresh } = await useFetch<ApiResponse<WorldDetails>>(`/api/v1/worlds/${worldId}`)
const details = computed(() => data.value?.data ?? null)
const initialWorld = data.value?.data.world
const initialVersion = data.value?.data.versions.find(version => version.id === initialWorld?.activeVersionId)
  ?? data.value?.data.versions[0]
const metadata = reactive<UpdateWorldInput>({ name: initialWorld?.name ?? '', summary: initialWorld?.summary ?? '' })
const candidate = reactive<CreateWorldVersionInput>({
  baseVersionId: initialVersion?.id ?? null,
  snapshot: { content: initialVersion?.snapshot.content ?? '' },
  changeSummary: '',
})
const comparison = reactive({ base: initialVersion?.id ?? '', target: data.value?.data.versions[0]?.id ?? '' })
const differences = shallowRef<VersionFieldDiff[] | null>(null)
const deletionImpact = shallowRef<DeletionImpact | null>(null)
const deletionConfirmed = shallowRef(false)
const actionLoading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)

/** @param event 已校验元数据。 @returns 请求完成时结束。 */
async function saveMetadata(event: FormSubmitEvent<UpdateWorldInput>): Promise<void> {
  await runAction('世界元数据已保存', async () => {
    await $fetch(`/api/v1/worlds/${worldId}`, { method: 'PATCH', body: event.data })
    await refresh()
  })
}

/** @param event 已校验候选版本输入。 @returns 请求完成时结束。 */
async function createCandidate(event: FormSubmitEvent<CreateWorldVersionInput>): Promise<void> {
  await runAction('候选版本已创建', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/versions`, { method: 'POST', body: event.data })
    candidate.changeSummary = ''
    await refresh()
  })
}

/** @param versionId 候选版本 UUID。 @returns 请求完成时结束。 */
async function publishVersion(versionId: string): Promise<void> {
  await runAction('世界版本已发布', async () => {
    await $fetch(`/api/v1/world-versions/${versionId}/publish`, { method: 'POST' })
    await refresh()
  })
}

/** @param versionId 已发布版本 UUID。 @returns 请求完成时结束。 */
async function rollbackVersion(versionId: string): Promise<void> {
  await runAction('当前版本指针已回滚', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/rollback`, { method: 'POST', body: { versionId } })
    await refresh()
  })
}

/** @returns 差异查询完成时结束。 */
async function compareVersions(): Promise<void> {
  await runAction(null, async () => {
    const response = await $fetch<ApiResponse<VersionFieldDiff[]>>('/api/v1/world-versions/compare', { query: comparison })
    differences.value = response.data
  })
}

/** @returns 删除影响查询完成时结束。 */
async function inspectDeletion(): Promise<void> {
  await runAction(null, async () => {
    const response = await $fetch<ApiResponse<DeletionImpact>>(`/api/v1/worlds/${worldId}/deletion-impact`)
    deletionImpact.value = response.data
    deletionConfirmed.value = false
  })
}

/** @returns 删除与导航完成时结束。 */
async function deleteWorld(): Promise<void> {
  if (!deletionConfirmed.value || !deletionImpact.value?.canDelete) return
  await runAction(null, async () => {
    await $fetch(`/api/v1/worlds/${worldId}`, { method: 'DELETE' })
    await navigateTo('/worlds')
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

/** @param timestamp UTC Unix 毫秒。 @returns 本地日期时间文本。 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <ContentPageHeader :title="details?.world.name || '世界详情'" description="正文版本不可覆盖；有任何人物关联时禁止删除世界。">
      <UButton to="/worlds" color="neutral" variant="ghost">返回列表</UButton>
    </ContentPageHeader>
    <UAlert v-if="error || !details" color="error" title="世界详情加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <template v-else>
      <UAlert v-if="actionError" class="mb-5" color="error" title="操作失败" :description="actionError" />
      <UAlert v-if="actionMessage" class="mb-5" color="success" title="操作完成" :description="actionMessage" />
      <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="space-y-6">
          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">元数据</h2></template>
            <UForm :schema="updateWorldSchema" :state="metadata" class="space-y-4" @submit="saveMetadata">
              <div class="grid gap-4 md:grid-cols-2">
                <UFormField name="name" label="世界名称" required><UInput v-model="metadata.name" class="w-full" /></UFormField>
                <UFormField name="summary" label="摘要"><UInput v-model="metadata.summary" class="w-full" /></UFormField>
              </div>
              <UButton type="submit" :loading="actionLoading">保存元数据</UButton>
            </UForm>
          </UCard>

          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">版本时间线</h2></template>
            <div class="space-y-4">
              <div v-for="version in details.versions" :key="version.id" class="rounded-md border border-default p-4">
                <div class="flex flex-wrap justify-between gap-3">
                  <div>
                    <div class="flex gap-2"><UBadge :color="version.status === 'published' ? 'success' : 'warning'" variant="subtle">{{ version.status === 'published' ? '已发布' : '候选' }}</UBadge><UBadge v-if="version.id === details.world.activeVersionId">当前</UBadge></div>
                    <p class="mt-2 font-medium text-highlighted">{{ version.changeSummary }}</p>
                    <p class="mt-1 text-xs text-muted">{{ formatTime(version.createdAt) }} · {{ version.id }}</p>
                  </div>
                  <UButton v-if="version.status === 'candidate'" size="sm" :loading="actionLoading" @click="publishVersion(version.id)">发布</UButton>
                  <UButton v-else-if="version.id !== details.world.activeVersionId" size="sm" color="neutral" variant="soft" :loading="actionLoading" @click="rollbackVersion(version.id)">回滚到此版</UButton>
                </div>
                <pre class="content-pre mt-3">{{ version.snapshot.content }}</pre>
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">创建候选版本</h2></template>
            <UForm :schema="createWorldVersionSchema" :state="candidate" class="space-y-4" @submit="createCandidate">
              <UFormField name="baseVersionId" label="基础版本" required><select v-model="candidate.baseVersionId" class="native-control"><option v-for="version in details.versions" :key="version.id" :value="version.id">{{ version.changeSummary }}</option></select></UFormField>
              <UFormField name="snapshot.content" label="世界规则与背景" required><UTextarea v-model="candidate.snapshot.content" class="w-full" :rows="10" autoresize /></UFormField>
              <UFormField name="changeSummary" label="变化摘要" required><UInput v-model="candidate.changeSummary" class="w-full" /></UFormField>
              <UButton type="submit" :loading="actionLoading">保存候选版本</UButton>
            </UForm>
          </UCard>

          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">版本差异</h2></template>
            <div class="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <select v-model="comparison.base" class="native-control" aria-label="基础版本"><option v-for="version in details.versions" :key="version.id" :value="version.id">{{ version.changeSummary }}</option></select>
              <select v-model="comparison.target" class="native-control" aria-label="目标版本"><option v-for="version in details.versions" :key="version.id" :value="version.id">{{ version.changeSummary }}</option></select>
              <UButton color="neutral" variant="soft" :loading="actionLoading" @click="compareVersions">比较</UButton>
            </div>
            <ContentPersonaVersionDiff v-if="differences" class="mt-5" :differences="differences" />
          </UCard>
        </div>

        <div class="space-y-6">
          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">关联对象</h2></template>
            <p class="mb-2 text-sm font-medium">人物</p>
            <div v-if="details.personas.length" class="space-y-2"><UButton v-for="persona in details.personas" :key="persona.id" :to="`/personas/${persona.id}`" color="neutral" variant="soft" block class="justify-start">{{ persona.name }}</UButton></div>
            <p v-else class="text-sm text-muted">无关联人物</p>
            <p class="mb-2 mt-5 text-sm font-medium">资料</p>
            <div v-if="details.sources.length" class="space-y-2"><UButton v-for="source in details.sources" :key="source.id" :to="`/sources/${source.id}`" color="neutral" variant="soft" block class="justify-start">{{ source.name }}</UButton></div>
            <p v-else class="text-sm text-muted">无关联资料</p>
          </UCard>
          <UCard>
            <template #header><h2 class="font-semibold text-error">永久删除</h2></template>
            <UButton v-if="!deletionImpact" color="error" variant="soft" :loading="actionLoading" @click="inspectDeletion">查看删除影响</UButton>
            <div v-else class="space-y-3 text-sm">
              <UAlert v-if="!deletionImpact.canDelete" color="warning" title="当前不能删除" :description="deletionImpact.blockers.join('；')" />
              <template v-else>
                <p>将删除 {{ deletionImpact.versionCount }} 个版本并解除 {{ deletionImpact.relatedSources.length }} 项资料关系。</p>
                <label class="flex items-start gap-2"><input v-model="deletionConfirmed" type="checkbox" class="mt-1"><span>我确认永久删除此世界设定。</span></label>
                <UButton color="error" :disabled="!deletionConfirmed" :loading="actionLoading" @click="deleteWorld">永久删除世界</UButton>
              </template>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </div>
</template>
