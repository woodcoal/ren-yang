<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, shallowRef } from 'vue'
import { createWorldVersionSchema, type CreateSourceInput, type CreateWorldVersionInput, updateWorldSchema, type UpdateWorldInput } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { DeletionImpact, SourceDetails, SourceSummary, VersionFieldDiff, WorldDetails } from '#shared/types/content'
import type { SourceFileSubmission } from '../../components/content/SourceImportForm.vue'
import { getApiErrorMessage } from '../../utils/apiError'

const worldId = String(useRoute().params.id)
const [{ data, error, refresh }, { data: sourceData, refresh: refreshSources }] = await Promise.all([
  useFetch<ApiResponse<WorldDetails>>(`/api/v1/worlds/${worldId}`),
  useFetch<ApiResponse<SourceSummary[]>>('/api/v1/sources'),
])
const details = computed(() => data.value?.data ?? null)
const allSources = computed(() => sourceData.value?.data ?? [])
const initialWorld = data.value?.data.world
const initialVersion = data.value?.data.versions.find(version => version.id === initialWorld?.activeVersionId) ?? data.value?.data.versions[0]
const metadata = reactive<UpdateWorldInput>({ name: initialWorld?.name ?? '', summary: initialWorld?.summary ?? '' })
const candidate = reactive<CreateWorldVersionInput>({ baseVersionId: initialVersion?.id ?? null, snapshot: { content: initialVersion?.snapshot.content ?? '' }, changeSummary: '' })
const comparison = reactive({ base: initialVersion?.id ?? '', target: data.value?.data.versions[0]?.id ?? '' })
const differences = shallowRef<VersionFieldDiff[] | null>(null)
const deletionImpact = shallowRef<DeletionImpact | null>(null)
const deletionConfirmed = shallowRef(false)
const actionLoading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)

/** 当前真正用于人物新任务的世界正文；尚未发布时为 null。 */
const activeContent = computed(() => details.value?.versions.find(version => version.id === details.value?.world.activeVersionId)?.snapshot.content ?? null)

/**
 * 保存世界名称和简短说明；这些内容只用于后台辨认，不会进入人物提示词。
 * @param event 已通过共享 Schema 校验的基本信息。
 * @returns 请求和页面数据刷新完成时结束。
 */
async function saveMetadata(event: FormSubmitEvent<UpdateWorldInput>): Promise<void> {
  await runAction('基本信息已保存', async () => {
    await $fetch(`/api/v1/worlds/${worldId}`, { method: 'PATCH', body: event.data })
    await refresh()
  })
}

/**
 * 从用户选定的基础版本创建一份待确认修改稿。
 * @param event 已通过共享 Schema 校验的版本正文和修改说明。
 * @returns 请求和页面数据刷新完成时结束。
 */
async function createCandidate(event: FormSubmitEvent<CreateWorldVersionInput>): Promise<void> {
  await runAction('修改稿已保存；确认使用前不会影响人物', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/versions`, { method: 'POST', body: event.data })
    candidate.changeSummary = ''
    await refresh()
  })
}

/**
 * 把指定修改稿发布为当前生效的世界设定。
 * @param versionId 待发布世界版本 UUID。
 * @returns 请求和页面数据刷新完成时结束。
 */
async function publishVersion(versionId: string): Promise<void> {
  await runAction('修改稿已确认，之后创建的新任务将使用这一版', async () => {
    await $fetch(`/api/v1/world-versions/${versionId}/publish`, { method: 'POST' })
    await refresh()
  })
}

/**
 * 恢复使用指定历史已发布版本，不删除其后的修改记录。
 * @param versionId 历史已发布世界版本 UUID。
 * @returns 请求和页面数据刷新完成时结束。
 */
async function activateVersion(versionId: string): Promise<void> {
  await runAction('已恢复使用所选版本；历史记录保持不变', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/rollback`, { method: 'POST', body: { versionId } })
    await refresh()
  })
}

/**
 * 永久删除服务端确认未使用的世界版本。
 * @param versionId 待删除世界版本 UUID。
 * @returns 请求、页面刷新和选择项修正完成时结束。
 */
async function deleteVersion(versionId: string): Promise<void> {
  await runAction('错误版本已永久删除', async () => {
    await $fetch(`/api/v1/world-versions/${versionId}`, { method: 'DELETE' })
    await refresh()
    const fallback = details.value?.versions.find(version => version.id === details.value?.world.activeVersionId) ?? details.value?.versions[0]
    if (candidate.baseVersionId === versionId) {
      candidate.baseVersionId = fallback?.id ?? null
      candidate.snapshot.content = fallback?.snapshot.content ?? ''
    }
    if (comparison.base === versionId) comparison.base = fallback?.id ?? ''
    if (comparison.target === versionId) comparison.target = fallback?.id ?? ''
    differences.value = null
  })
}

/**
 * 把选定基础版本的正文复制到修改区，避免基于错误正文继续编辑。
 * @returns 无返回值。
 */
function copySelectedBase(): void {
  const selected = details.value?.versions.find(version => version.id === candidate.baseVersionId)
  candidate.snapshot.content = selected?.snapshot.content ?? ''
}

/**
 * 比较两个用户明确选择的世界版本正文。
 * @returns 差异查询完成时结束。
 */
async function compareVersions(): Promise<void> {
  if (!comparison.base || !comparison.target) return
  await runAction(null, async () => {
    const response = await $fetch<ApiResponse<VersionFieldDiff[]>>('/api/v1/world-versions/compare', { query: comparison })
    differences.value = response.data
  })
}

/**
 * 把一项已有资料关联到当前世界，资料本身保持可复用。
 * @param sourceId 已存在资料 UUID。
 * @returns 关联请求和世界、资料列表刷新完成时结束。
 */
async function linkSource(sourceId: string): Promise<void> {
  await runAction('资料已加入这个世界', async () => {
    await $fetch(`/api/v1/sources/${sourceId}/links`, { method: 'POST', body: { targetType: 'world', targetId: worldId, priority: 100 } })
    await Promise.all([refresh(), refreshSources()])
  })
}

/**
 * 解除一项资料与当前世界的关联，不删除资料正文或其他关联。
 * @param sourceId 当前已关联资料 UUID。
 * @returns 解除请求和世界、资料列表刷新完成时结束。
 */
async function unlinkSource(sourceId: string): Promise<void> {
  await runAction('资料已从这个世界移除，资料本身仍然保留', async () => {
    await $fetch(`/api/v1/sources/${sourceId}/links/${encodeURIComponent(`world:${worldId}`)}`, { method: 'DELETE' })
    await Promise.all([refresh(), refreshSources()])
  })
}

/**
 * 创建粘贴文本资料，并在创建成功后自动关联到当前世界。
 * @param input 已通过共享 Schema 校验的资料名称、用途和正文。
 * @returns 创建、关联和列表刷新完成时结束。
 */
async function createPastedSource(input: CreateSourceInput): Promise<void> {
  await createAndLinkSource(async () => await $fetch<ApiResponse<SourceDetails>>('/api/v1/sources', { method: 'POST', body: input }))
}

/**
 * 上传文件资料，并在创建成功后自动关联到当前世界。
 * @param input 已校验的资料名称、用途和浏览器文件。
 * @returns 上传、关联和列表刷新完成时结束。
 */
async function importSourceFile(input: SourceFileSubmission): Promise<void> {
  const body = new FormData()
  body.set('name', input.name)
  body.set('role', input.role)
  body.set('file', input.file)
  await createAndLinkSource(async () => await $fetch<ApiResponse<SourceDetails>>('/api/v1/sources/files', { method: 'POST', body }))
}

/**
 * 执行资料创建动作，并把创建结果立即关联到当前世界。
 * @param createSource 返回完整资料详情的创建请求。
 * @returns 创建、关联和列表刷新完成时结束。
 */
async function createAndLinkSource(createSource: () => Promise<ApiResponse<SourceDetails>>): Promise<void> {
  await runAction('新资料已创建并加入这个世界', async () => {
    const response = await createSource()
    await $fetch(`/api/v1/sources/${response.data.source.id}/links`, { method: 'POST', body: { targetType: 'world', targetId: worldId, priority: 100 } })
    await Promise.all([refresh(), refreshSources()])
  })
}

/**
 * 查询永久删除整个世界会影响哪些记录。
 * @returns 删除影响查询完成时结束。
 */
async function inspectDeletion(): Promise<void> {
  await runAction(null, async () => {
    const response = await $fetch<ApiResponse<DeletionImpact>>(`/api/v1/worlds/${worldId}/deletion-impact`)
    deletionImpact.value = response.data
    deletionConfirmed.value = false
  })
}

/**
 * 在用户确认且服务端允许时永久删除整个世界并返回列表页。
 * @returns 删除和页面导航完成时结束。
 */
async function deleteWorld(): Promise<void> {
  if (!deletionConfirmed.value || !deletionImpact.value?.canDelete) return
  await runAction(null, async () => {
    await $fetch(`/api/v1/worlds/${worldId}`, { method: 'DELETE' })
    await navigateTo('/worlds')
  })
}

/**
 * 统一管理页面写操作的等待状态和安全提示。
 * @param successMessage 成功后展示的通俗消息；无需提示时为 null。
 * @param action 当前需要执行的异步页面动作。
 * @returns 操作结束且等待状态恢复时完成。
 */
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
    <ContentPageHeader :title="details?.world.name || '世界详情'" description="世界是一组人物共享的背景。名称和简短说明只方便管理，当前生效设定才会提供给人物。">
      <UButton to="/worlds" color="neutral" variant="ghost">返回世界列表</UButton>
    </ContentPageHeader>
    <UAlert v-if="error || !details" color="error" title="世界详情加载失败" :description="error ? getApiErrorMessage(error, '世界详情请求失败') : '服务端没有返回世界详情'" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <template v-else>
      <UAlert v-if="actionError" class="mb-5" color="error" title="操作失败" :description="actionError" />
      <UAlert v-if="actionMessage" class="mb-5" color="success" title="操作完成" :description="actionMessage" />

      <UCard class="mb-6">
        <template #header><div><h2 class="font-semibold text-highlighted">基本信息</h2><p class="mt-1 text-sm text-muted">只用于后台查找和辨认，不会交给人物，也不会影响 AI 输出。</p></div></template>
        <UForm :schema="updateWorldSchema" :state="metadata" class="space-y-4" @submit="saveMetadata">
          <div class="grid gap-4 md:grid-cols-2">
            <UFormField name="name" label="世界名称" required><UInput v-model="metadata.name" class="w-full" /></UFormField>
            <UFormField name="summary" label="简短说明" description="例如：三国时期主要人物共同使用的历史背景。"><UInput v-model="metadata.summary" class="w-full" /></UFormField>
          </div>
          <UButton type="submit" :loading="actionLoading">保存基本信息</UButton>
        </UForm>
      </UCard>

      <ContentWorldSourceManager class="mb-6" :linked-sources="details.sources" :all-sources="allSources" :loading="actionLoading" :error-message="actionError" @link="linkSource" @unlink="unlinkSource" @paste="createPastedSource" @file="importSourceFile" />

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="space-y-6">
          <UCard>
            <template #header><div><h2 class="font-semibold text-highlighted">当前生效设定</h2><p class="mt-1 text-sm text-muted">创建人物的新任务时，系统会把这里的内容作为共同背景。已经创建的历史任务不会随之改变。</p></div></template>
            <pre v-if="activeContent" class="content-pre max-h-[32rem] overflow-y-auto">{{ activeContent }}</pre>
            <UAlert v-else color="warning" title="还没有生效版本" description="请在下面的修改记录中确认并使用初始修改稿。未发布前，人物任务不会读取这个世界的正文。" />
          </UCard>

          <UCard>
            <template #header><div><h2 class="font-semibold text-highlighted">修改世界设定</h2><p class="mt-1 text-sm text-muted">先保存为修改稿，检查无误后再确认使用；不会直接覆盖正在生效的内容。</p></div></template>
            <UForm :schema="createWorldVersionSchema" :state="candidate" class="space-y-4" @submit="createCandidate">
              <UFormField name="baseVersionId" label="从哪一版开始修改" required>
                <select v-model="candidate.baseVersionId" class="native-control" @change="copySelectedBase"><option v-for="version in details.versions" :key="version.id" :value="version.id">{{ version.changeSummary }}（{{ version.status === 'published' ? '已发布' : '修改稿' }}）</option></select>
              </UFormField>
              <UFormField name="snapshot.content" label="详细规则与背景" description="这部分会提供给人物，请写清时代、地点、关系、客观规则和必须遵守的限制。" required><UTextarea v-model="candidate.snapshot.content" class="w-full" :rows="12" autoresize /></UFormField>
              <UFormField name="changeSummary" label="这次改了什么" description="用一句话说明，方便以后查找和比较。" required><UInput v-model="candidate.changeSummary" class="w-full" /></UFormField>
              <UButton type="submit" :loading="actionLoading">保存修改稿</UButton>
            </UForm>
          </UCard>

          <ContentWorldVersionHistory :versions="details.versions" :active-version-id="details.world.activeVersionId" :loading="actionLoading" @publish="publishVersion" @activate="activateVersion" @delete="deleteVersion" />

          <UCard v-if="details.versions.length > 1">
            <template #header><div><h2 class="font-semibold text-highlighted">比较两个版本</h2><p class="mt-1 text-sm text-muted">查看世界正文发生了哪些变化。</p></div></template>
            <div class="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <select v-model="comparison.base" class="native-control" aria-label="较早版本"><option v-for="version in details.versions" :key="version.id" :value="version.id">{{ version.changeSummary }}</option></select>
              <select v-model="comparison.target" class="native-control" aria-label="较新版本"><option v-for="version in details.versions" :key="version.id" :value="version.id">{{ version.changeSummary }}</option></select>
              <UButton color="neutral" variant="soft" :loading="actionLoading" @click="compareVersions">开始比较</UButton>
            </div>
            <ContentPersonaVersionDiff v-if="differences" class="mt-5" :differences="differences" />
          </UCard>
        </div>

        <div class="space-y-6">
          <ContentWorldPersonaList :personas="details.personas" />
          <UCard>
            <template #header><div><h2 class="font-semibold text-error">删除整个世界</h2><p class="mt-1 text-sm text-muted">只删除世界、全部版本和资料关联，不删除资料本身。</p></div></template>
            <UButton v-if="!deletionImpact" color="error" variant="soft" :loading="actionLoading" @click="inspectDeletion">先查看会删除什么</UButton>
            <div v-else class="space-y-3 text-sm">
              <UAlert v-if="!deletionImpact.canDelete" color="warning" title="现在不能删除" :description="deletionImpact.blockers.join('；')" />
              <template v-else>
                <p>将永久删除 {{ deletionImpact.versionCount }} 条修改记录，并解除 {{ deletionImpact.relatedSources.length }} 项资料关联。</p>
                <UCheckbox v-model="deletionConfirmed" label="我确认永久删除整个世界" />
                <UButton color="error" :disabled="!deletionConfirmed" :loading="actionLoading" @click="deleteWorld">永久删除整个世界</UButton>
              </template>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </div>
</template>
