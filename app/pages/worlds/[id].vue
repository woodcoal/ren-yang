<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, shallowRef } from 'vue'
import type { CreateSourceWithTargetsInput, SaveSoulDraftInput, UpdateWorldInput } from '#shared/schemas/content'
import { updateWorldSchema } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { DeletionImpact, SoulWorkspaceView, SourceDetails, SourceSummary, WorldDetails } from '#shared/types/content'
import type { WorldGrowthWorkspaceView } from '#shared/types/learning'
import type { AnalysisBatchView, ProposedLearningContentView } from '#shared/types/analysis'
import AnalysisPanel from '../../components/analysis/AnalysisPanel.vue'
import type { SourceFileSubmission } from '../../components/content/SourceImportForm.vue'
import { getApiErrorMessage } from '../../utils/apiError'

type WorldTab = 'overview' | 'soul' | 'growth' | 'sources' | 'relations'

const worldId = String(useRoute().params.id)
const [
  { data, error, refresh },
  { data: soulData, refresh: refreshSoul },
  { data: sourceData, refresh: refreshSources },
  { data: growthData, refresh: refreshGrowth },
  { data: analysisData, refresh: refreshAnalysis },
] = await Promise.all([
  useFetch<ApiResponse<WorldDetails>>(`/api/v1/worlds/${worldId}`),
  useFetch<ApiResponse<SoulWorkspaceView>>(`/api/v1/worlds/${worldId}/soul`),
  useFetch<ApiResponse<SourceSummary[]>>('/api/v1/sources'),
  useFetch<ApiResponse<WorldGrowthWorkspaceView>>(`/api/v1/worlds/${worldId}/growth`),
  useFetch<ApiResponse<AnalysisBatchView | null>>('/api/v1/analysis-batches/latest', { query: { analysisType: 'world_growth', subjectId: worldId } }),
])

const details = computed(() => data.value?.data ?? null)
const soul = computed(() => soulData.value?.data ?? null)
const allSources = computed(() => sourceData.value?.data ?? [])
const growthWorkspace = computed(() => growthData.value?.data ?? { sources: [], growth: [] })
const growthAnalysis = computed(() => analysisData.value?.data ?? null)
const tabs: Array<{ id: WorldTab, label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'soul', label: '灵魂' },
  { id: 'growth', label: '成长' },
  { id: 'sources', label: '资料' },
  { id: 'relations', label: '人物与管理' },
]
const selectedTab = shallowRef<WorldTab>('overview')
const metadata = reactive<UpdateWorldInput>({
  name: details.value?.world.name ?? '',
  summary: details.value?.world.summary ?? '',
})
const deletionImpact = shallowRef<DeletionImpact | null>(null)
const deletionConfirmed = shallowRef(false)
const actionLoading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)
const enableConfirmationOpen = shallowRef(false)
const disableConfirmationOpen = shallowRef(false)

/**
 * 切换世界工作区标签。
 * @param tab 目标标签。
 * @returns 无返回值。
 */
function selectTab(tab: WorldTab): void {
  selectedTab.value = tab
}

/**
 * 保存世界后台名称和简介。
 * @param event 已校验基本信息。
 * @returns 保存和刷新完成时结束。
 */
async function saveMetadata(event: FormSubmitEvent<UpdateWorldInput>): Promise<void> {
  await runAction('世界基本信息已保存', async () => {
    await $fetch(`/api/v1/worlds/${worldId}`, { method: 'PATCH', body: event.data })
    await refresh()
  })
}

/**
 * 保存世界当前灵魂草稿。
 * @param input 完整草稿输入。
 * @returns 保存和刷新完成时结束。
 */
async function saveSoulDraft(input: SaveSoulDraftInput): Promise<void> {
  await runAction('世界灵魂修改稿已保存，尚未影响人物任务', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/soul/draft`, { method: 'PUT', body: input })
    await Promise.all([refresh(), refreshSoul()])
  })
}

/**
 * 发布世界当前灵魂草稿。
 * @returns 发布和刷新完成时结束。
 */
async function publishSoul(): Promise<void> {
  await runAction('世界灵魂已发布，之后创建的新任务将使用这一版', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/soul/publish`, { method: 'POST' })
    await Promise.all([refresh(), refreshSoul()])
  })
}

/**
 * 删除世界当前未发布灵魂草稿。
 * @returns 删除和刷新完成时结束。
 */
async function deleteSoulDraft(): Promise<void> {
  await runAction('未发布的世界灵魂修改稿已删除', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/soul/draft`, { method: 'DELETE' })
    await Promise.all([refresh(), refreshSoul()])
  })
}

/**
 * 从世界历史版本建立新的当前草稿。
 * @param versionId 历史灵魂版本 UUID。
 * @returns 创建和刷新完成时结束。
 */
async function createDraftFromVersion(versionId: string): Promise<void> {
  await runAction('历史世界灵魂已复制为修改稿', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/soul/draft-from-version`, {
      method: 'POST',
      body: { versionId },
    })
    await refreshSoul()
  })
}

/** @param input 世界资料批量启用状态。 @returns 更新和成长工作区刷新完成时结束。 */
async function updateWorldSourceStatus(input: { ids: string[], isEnabled: boolean }): Promise<void> {
  await runAction(input.isEnabled ? '所选世界资料已参加成长分析' : '所选世界资料已不参加成长分析', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/sources/status`, { method: 'PATCH', body: input })
    await refreshGrowth()
  })
}

/** @param input 人工世界成长候选。 @returns 创建和成长工作区刷新完成时结束。 */
async function createWorldGrowth(input: { content: string, scope: string, importance: number, sourceIds: string[] }): Promise<void> {
  await runAction('世界成长候选已创建，确认前不会进入人物任务', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/growth`, { method: 'POST', body: input })
    await refreshGrowth()
  })
}

/** @param input 世界成长批量目标状态。 @returns 审核和成长工作区刷新完成时结束。 */
async function updateWorldGrowthStatus(input: { ids: string[], status: 'active' | 'archived' | 'rejected' }): Promise<void> {
  await runAction('世界成长状态已更新', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/growth/status`, { method: 'PATCH', body: input })
    await refreshGrowth()
  })
}

/** @param mode 增量或完整重建。 @returns 批次创建和状态刷新完成时结束。 */
async function analyzeWorldGrowth(mode: 'incremental' | 'full_rebuild'): Promise<void> {
  await runAction('世界成长分析已排队；稍后刷新状态查看 AI 提案', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/growth/analyze`, { method: 'POST', body: { mode } })
    await refreshAnalysis()
  })
}

/** @param decision 单项人工审核。 @returns 应用和成长工作区刷新完成时结束。 */
async function reviewWorldGrowthProposal(decision: {
  proposalId: string
  action: 'accept' | 'reject'
  reviewed?: ProposedLearningContentView | null
}): Promise<void> {
  if (!growthAnalysis.value) return
  await runAction(decision.action === 'accept' ? '世界成长提案已确认并应用' : '世界成长提案已拒绝', async () => {
    await $fetch(`/api/v1/analysis-batches/${growthAnalysis.value!.id}/review`, { method: 'POST', body: { decisions: [decision] } })
    await Promise.all([refreshAnalysis(), refreshGrowth()])
  })
}

/**
 * 把选中的已有资料依次关联到当前世界。
 * @param sourceIds 资料 UUID 列表。
 * @returns 全部关联和刷新完成时结束。
 */
async function linkSources(sourceIds: string[]): Promise<void> {
  await runAction(`${sourceIds.length} 项资料已加入这个世界`, async () => {
    try {
      for (const sourceId of sourceIds) {
        await $fetch(`/api/v1/sources/${sourceId}/links`, {
          method: 'POST',
          body: { targetType: 'world', targetId: worldId, priority: 100 },
        })
      }
    }
    finally {
      // 单项接口可能在批量处理中途失败，仍需刷新已成功写入的关联。
      await Promise.all([refresh(), refreshSources()])
    }
  })
}

/**
 * 解除资料与世界的关系，不删除资料正文。
 * @param sourceId 资料 UUID。
 * @returns 解除和刷新完成时结束。
 */
async function unlinkSource(sourceId: string): Promise<void> {
  await runAction('资料已移出这个世界，资料本身仍保留', async () => {
    await $fetch(`/api/v1/sources/${sourceId}/links/${encodeURIComponent(`world:${worldId}`)}`, { method: 'DELETE' })
    await Promise.all([refresh(), refreshSources()])
  })
}

/**
 * 修改资料全局启用状态，并刷新世界资料卡。
 * @param input 资料 UUID 与目标启用状态。
 * @returns 状态请求和资料刷新完成时结束。
 */
async function updateLinkedSourceStatus(input: { sourceId: string, isEnabled: boolean }): Promise<void> {
  await runAction(input.isEnabled ? '资料已启用' : '资料已禁用', async () => {
    await $fetch(`/api/v1/sources/${input.sourceId}/status`, { method: 'PATCH', body: { isEnabled: input.isEnabled } })
    await Promise.all([refresh(), refreshSources()])
  })
}

/**
 * 创建粘贴资料并立即关联当前世界。
 * @param input 已校验资料输入。
 * @returns 创建和关联完成时结束。
 */
async function createPastedSource(input: CreateSourceWithTargetsInput): Promise<void> {
  await runAction('新资料已创建并加入这个世界', async () => {
    await $fetch<ApiResponse<SourceDetails>>('/api/v1/sources', {
      method: 'POST',
      body: { ...input, targets: [{ targetType: 'world', targetId: worldId }] },
    })
    await Promise.all([refresh(), refreshSources()])
  })
}

/**
 * 逐个上传文件资料并在同一资料事务中关联当前世界。
 * @param input 共用用途和带独立名称的文件列表。
 * @returns 全部文件处理和页面刷新完成时结束。
 */
async function importSourceFile(input: SourceFileSubmission): Promise<void> {
  actionLoading.value = true
  actionError.value = null
  actionMessage.value = null
  let succeeded = 0
  const failures: string[] = []
  try {
    for (const item of input.files) {
      const body = new FormData()
      body.set('name', item.name)
      body.set('role', input.role)
      body.set('targets', JSON.stringify([{ targetType: 'world', targetId: worldId }]))
      body.set('file', item.file)
      try {
        await $fetch<ApiResponse<SourceDetails>>('/api/v1/sources/files', { method: 'POST', body })
        succeeded += 1
      }
      catch (requestError: unknown) {
        failures.push(`${item.file.name}：${getApiErrorMessage(requestError, '导入失败')}`)
      }
    }
    if (succeeded > 0) await Promise.all([refresh(), refreshSources()])
    if (failures.length > 0) {
      actionError.value = `成功 ${succeeded} 个，失败 ${failures.length} 个。${failures.join('；')}`
    }
    else {
      actionMessage.value = `${succeeded} 个新资料已创建并加入这个世界`
    }
  }
  finally {
    actionLoading.value = false
  }
}

/**
 * 查询永久删除世界的影响范围。
 * @returns 查询完成时结束。
 */
async function inspectDeletion(): Promise<void> {
  await runAction(null, async () => {
    const response = await $fetch<ApiResponse<DeletionImpact>>(`/api/v1/worlds/${worldId}/deletion-impact`)
    deletionImpact.value = response.data
    deletionConfirmed.value = false
  })
}

/**
 * 在用户确认后永久删除世界。
 * @returns 删除和导航完成时结束。
 */
async function deleteWorld(): Promise<void> {
  if (!deletionConfirmed.value || !deletionImpact.value?.canDelete) return
  await runAction(null, async () => {
    await $fetch(`/api/v1/worlds/${worldId}`, { method: 'DELETE' })
    await navigateTo('/worlds')
  })
}

/**
 * 写入世界启用状态，不删除世界版本、人物关系、资料或历史记录。
 * @param isEnabled 需要写入的新状态。
 * @returns 状态请求和详情刷新完成时结束。
 */
async function updateWorldStatus(isEnabled: boolean): Promise<void> {
  await runAction(isEnabled ? '世界已启用' : '世界已禁用', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/status`, { method: 'PATCH', body: { isEnabled } })
    await refresh()
  })
}

/**
 * 根据世界当前状态打开启用或禁用二次确认框。
 * @returns 确认框打开时结束。
 */
async function requestWorldStatusChange(): Promise<void> {
  if (!details.value) return
  if (details.value.world.isEnabled) {
    disableConfirmationOpen.value = true
    return
  }
  enableConfirmationOpen.value = true
}

/** @returns 用户确认后的启用请求完成时结束。 */
async function confirmEnableWorld(): Promise<void> {
  enableConfirmationOpen.value = false
  await updateWorldStatus(true)
}

/** @returns 用户确认后的禁用请求完成时结束。 */
async function confirmDisableWorld(): Promise<void> {
  disableConfirmationOpen.value = false
  await updateWorldStatus(false)
}

/**
 * 统一管理页面动作状态与通俗反馈。
 * @param successMessage 成功提示；不需要时为 null。
 * @param action 当前异步动作。
 * @returns 动作结束且等待状态恢复时完成。
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
    <ContentPageHeader :title="details?.world.name || '世界工作区'"
      :description="details?.world.summary || '世界是多个人物共享的背景，也拥有自己的灵魂和成长。'">
      <UButton v-if="details" color="neutral" variant="soft" :loading="actionLoading" @click="requestWorldStatusChange">
        {{ details.world.isEnabled ? '禁用世界' : '启用世界' }}</UButton>
      <UButton to="/worlds" color="neutral" variant="ghost">返回世界列表</UButton>
    </ContentPageHeader>

    <UAlert v-if="error || !details || !soul" color="error" title="世界工作区加载失败"
      :actions="[{ label: '重试', onClick: () => Promise.all([refresh(), refreshSoul()]) }]" />
    <template v-else>
      <UAlert v-if="actionError" class="mb-5" color="error" title="操作失败" :description="actionError" />
      <UAlert v-if="actionMessage" class="mb-5" color="success" title="操作完成" :description="actionMessage" />
      <UAlert v-if="!details.world.isEnabled" class="mb-6" color="warning" title="世界当前已禁用"
        description="世界版本、人物关系、资料和历史任务仍会保留，但该世界不会进入后续新任务。" />

      <div class="status-strip page-status-strip mb-6">
        <div class="status-cell"><span class="status-kicker">关联人物</span><strong class="status-value">{{
          details.personas.length }} 个</strong></div>
        <div class="status-cell"><span class="status-kicker">当前灵魂</span><strong class="status-value">{{
          soul.activeVersion ? '已发布，可用于任务' : '尚未发布' }}</strong></div>
        <div class="status-cell"><span class="status-kicker">世界资料</span><strong class="status-value">{{
          details.sources.length }} 项</strong></div>
        <div class="status-cell"><span class="status-kicker">待确认修改</span><strong class="status-value">{{ soul.draft ? '1
            份灵魂修改稿' : '没有灵魂修改稿' }}</strong></div>
      </div>

      <nav class="mind-tabs mb-6" aria-label="世界工作区标签">
        <button v-for="tab in tabs" :key="tab.id" class="mind-tab" :aria-selected="selectedTab === tab.id"
          @click="selectTab(tab.id)">{{ tab.label }}</button>
      </nav>

      <div v-if="selectedTab === 'overview'" class="grid gap-6 xl:grid-cols-2">
        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">当前世界状态</h2>
          </template>
          <p class="whitespace-pre-wrap text-sm leading-6 text-muted">{{ soul.activeVersion?.snapshot.runtimeSummary ||
            '世界还没有发布灵魂。发布前，关联人物的新任务不会读取世界。' }}</p>
          <UButton class="mt-4" color="neutral" variant="soft" @click="selectTab('soul')">查看和编辑世界灵魂</UButton>
        </UCard>
        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">世界如何变化</h2>
          </template>
          <div class="space-y-3 text-sm text-muted">
            <p>灵魂保存稳定的世界规则和受限运行摘要。</p>
            <p>成长从已启用的世界资料中分析，候选仍需人工确认。</p>
            <p>世界没有人物式记忆，不会从人物处理过程反向形成长期规则。</p>
          </div>
        </UCard>
      </div>

      <ContentSoulWorkspace v-else-if="selectedTab === 'soul'" :workspace="soul" :loading="actionLoading"
        @save="saveSoulDraft" @publish="publishSoul" @delete="deleteSoulDraft" @from-version="createDraftFromVersion" />

      <div v-else-if="selectedTab === 'growth'" class="space-y-6">
        <AnalysisPanel title="世界成长" :batch="growthAnalysis" :loading="actionLoading"
          @analyze="analyzeWorldGrowth" @refresh="refreshAnalysis" @review="reviewWorldGrowthProposal" />
        <div class="grid items-start gap-6 xl:grid-cols-2">
          <LearningWorldGrowthSourcePanel :items="growthWorkspace.sources" :loading="actionLoading"
            @status="updateWorldSourceStatus" />
          <LearningGrowthRecordPanel subject-label="世界" :items="growthWorkspace.growth"
            :sources="growthWorkspace.sources.map(item => ({ id: item.id, label: item.name }))" :loading="actionLoading"
            @create="createWorldGrowth" @status="updateWorldGrowthStatus" />
        </div>
      </div>

      <ContentSubjectSourceManager v-else-if="selectedTab === 'sources'" subject-type="world"
        :subject-name="details.world.name" :linked-sources="details.sources"
        :all-sources="allSources" :loading="actionLoading" :error-message="actionError" @link="linkSources"
        @unlink="unlinkSource" @status="updateLinkedSourceStatus" @paste="createPastedSource" @file="importSourceFile" />

      <div v-else class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="space-y-6">
          <UCard>
            <template #header>
              <div>
                <h2 class="font-semibold text-highlighted">基本信息</h2>
                <p class="mt-1 text-sm text-muted">名称和简介只方便后台辨认，不会进入提示词。</p>
              </div>
            </template>
            <UForm :schema="updateWorldSchema" :state="metadata" class="grid gap-4 md:grid-cols-2"
              @submit="saveMetadata">
              <UFormField name="name" label="世界名称" required>
                <UInput v-model="metadata.name" class="w-full" />
              </UFormField>
              <UFormField name="summary" label="后台简介">
                <UInput v-model="metadata.summary" class="w-full" />
              </UFormField>
              <div class="md:col-span-2">
                <UButton type="submit" :loading="actionLoading">保存基本信息</UButton>
              </div>
            </UForm>
          </UCard>
          <ContentWorldPersonaList :personas="details.personas" />
        </div>
        <UCard>
          <template #header>
            <h2 class="font-semibold text-error">删除世界</h2>
          </template>
          <UButton v-if="!deletionImpact" color="error" variant="soft" :loading="actionLoading"
            @click="inspectDeletion">
            先查看会删除什么</UButton>
          <div v-else class="space-y-3 text-sm">
            <UAlert v-if="!deletionImpact.canDelete" color="warning" title="现在不能删除"
              :description="deletionImpact.blockers.join('；')" />
            <template v-else>
              <p>将删除 {{ deletionImpact.versionCount }} 个灵魂版本，并解除 {{ deletionImpact.relatedSources.length }} 项资料关系。</p>
              <UCheckbox v-model="deletionConfirmed" label="我确认永久删除这个世界" />
              <UButton color="error" :disabled="!deletionConfirmed" :loading="actionLoading" @click="deleteWorld">永久删除世界
              </UButton>
            </template>
          </div>
        </UCard>
      </div>
    </template>

    <UModal v-model:open="enableConfirmationOpen" title="确认启用世界" description="启用后，该世界可以重新进入后续新任务。">
      <template #body>
        <p class="text-sm text-muted">确定启用“{{ details?.world.name }}”吗？</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="actionLoading" @click="enableConfirmationOpen = false">取消</UButton>
          <UButton color="success" :loading="actionLoading" @click="confirmEnableWorld">确认启用</UButton>
        </div>
      </template>
    </UModal>

    <UModal v-model:open="disableConfirmationOpen" title="确认禁用世界" description="禁用不会删除世界版本、人物关系、资料或历史任务。">
      <template #body>
        <p class="text-sm text-muted">确定禁用“{{ details?.world.name }}”吗？该世界将停止进入后续新任务，关联人物仍可按自身设定工作。</p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="actionLoading" @click="disableConfirmationOpen = false">取消
          </UButton>
          <UButton color="error" :loading="actionLoading" @click="confirmDisableWorld">确认禁用</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
