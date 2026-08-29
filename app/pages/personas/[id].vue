<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, shallowRef } from 'vue'
import type { SaveSoulDraftInput, UpdatePersonaInput } from '#shared/schemas/content'
import { updatePersonaSchema } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { DeletionImpact, PersonaDetails, SoulWorkspaceView, WorldSummary } from '#shared/types/content'
import type { PersonaGrowthWorkspaceView, PersonaMemoryWorkspaceView } from '#shared/types/learning'
import type { AnalysisBatchView, ProposedLearningContentView } from '#shared/types/analysis'
import { getApiErrorMessage } from '../../utils/apiError'

type PersonaTab = 'overview' | 'soul' | 'growth' | 'memory' | 'relations'

const personaId = String(useRoute().params.id)
const [
  { data, error, refresh },
  { data: soulData, refresh: refreshSoul },
  { data: worldData },
  { data: growthData, refresh: refreshGrowth },
  { data: memoryData, refresh: refreshMemory },
  { data: growthAnalysisData, refresh: refreshGrowthAnalysis },
  { data: memoryAnalysisData, refresh: refreshMemoryAnalysis },
] = await Promise.all([
  useFetch<ApiResponse<PersonaDetails>>(`/api/v1/personas/${personaId}`),
  useFetch<ApiResponse<SoulWorkspaceView>>(`/api/v1/personas/${personaId}/soul`),
  useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds'),
  useFetch<ApiResponse<PersonaGrowthWorkspaceView>>(`/api/v1/personas/${personaId}/growth`),
  useFetch<ApiResponse<PersonaMemoryWorkspaceView>>(`/api/v1/personas/${personaId}/memories`),
  useFetch<ApiResponse<AnalysisBatchView | null>>('/api/v1/analysis-batches/latest', { query: { analysisType: 'persona_growth', subjectId: personaId } }),
  useFetch<ApiResponse<AnalysisBatchView | null>>('/api/v1/analysis-batches/latest', { query: { analysisType: 'persona_memory', subjectId: personaId } }),
])

const details = computed(() => data.value?.data ?? null)
const soul = computed(() => soulData.value?.data ?? null)
const worlds = computed(() => worldData.value?.data ?? [])
const growthWorkspace = computed(() => growthData.value?.data ?? { feedbackSources: [], growth: [] })
const memoryWorkspace = computed(() => memoryData.value?.data ?? { operationRecords: [], memories: [] })
const growthAnalysis = computed(() => growthAnalysisData.value?.data ?? null)
const memoryAnalysis = computed(() => memoryAnalysisData.value?.data ?? null)
const tabs: Array<{ id: PersonaTab, label: string }> = [
  { id: 'overview', label: '概览' },
  { id: 'soul', label: '灵魂' },
  { id: 'growth', label: '成长' },
  { id: 'memory', label: '记忆' },
  { id: 'relations', label: '世界与资料' },
]
const selectedTab = shallowRef<PersonaTab>('overview')
const metadata = reactive<UpdatePersonaInput>({
  name: details.value?.persona.name ?? '',
  worldId: details.value?.persona.worldId ?? null,
})
const deletionImpact = shallowRef<DeletionImpact | null>(null)
const deletionConfirmed = shallowRef(false)
const actionLoading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)

/**
 * 切换人物工作区标签。
 * @param tab 目标标签。
 * @returns 无返回值。
 */
function selectTab(tab: PersonaTab): void {
  selectedTab.value = tab
}

/**
 * 保存人物名称和所属世界。
 * @param event 已通过共享 Schema 校验的基本信息。
 * @returns 请求和详情刷新完成时结束。
 */
async function saveMetadata(event: FormSubmitEvent<UpdatePersonaInput>): Promise<void> {
  await runAction('人物基本信息已保存', async () => {
    await $fetch(`/api/v1/personas/${personaId}`, { method: 'PATCH', body: event.data })
    await refresh()
  })
}

/**
 * 保存人物当前灵魂草稿。
 * @param input 完整草稿输入。
 * @returns 保存和工作区刷新完成时结束。
 */
async function saveSoulDraft(input: SaveSoulDraftInput): Promise<void> {
  await runAction('灵魂修改稿已保存，尚未影响新任务', async () => {
    await $fetch(`/api/v1/personas/${personaId}/soul/draft`, { method: 'PUT', body: input })
    await Promise.all([refresh(), refreshSoul()])
  })
}

/**
 * 发布人物当前灵魂草稿。
 * @returns 发布和页面刷新完成时结束。
 */
async function publishSoul(): Promise<void> {
  await runAction('灵魂已发布，之后创建的新任务将使用这一版', async () => {
    await $fetch(`/api/v1/personas/${personaId}/soul/publish`, { method: 'POST' })
    await Promise.all([refresh(), refreshSoul()])
  })
}

/**
 * 删除人物当前未发布灵魂草稿。
 * @returns 删除和页面刷新完成时结束。
 */
async function deleteSoulDraft(): Promise<void> {
  await runAction('未发布的灵魂修改稿已删除', async () => {
    await $fetch(`/api/v1/personas/${personaId}/soul/draft`, { method: 'DELETE' })
    await Promise.all([refresh(), refreshSoul()])
  })
}

/**
 * 从历史版本建立新的当前灵魂草稿。
 * @param versionId 历史灵魂版本 UUID。
 * @returns 创建和页面刷新完成时结束。
 */
async function createDraftFromVersion(versionId: string): Promise<void> {
  await runAction('历史版本已复制为修改稿，发布前不会影响任务', async () => {
    await $fetch(`/api/v1/personas/${personaId}/soul/draft-from-version`, {
      method: 'POST',
      body: { versionId },
    })
    await refreshSoul()
  })
}

/** @param input 新人物反馈资料。 @returns 创建和成长工作区刷新完成时结束。 */
async function createFeedbackSource(input: { title: string, content: string, sourceType: 'manual' }): Promise<void> {
  await runAction('反馈资料已加入人物成长来源', async () => {
    await $fetch(`/api/v1/personas/${personaId}/feedback-sources`, { method: 'POST', body: input })
    await refreshGrowth()
  })
}

/** @param input 反馈资料批量启用状态。 @returns 更新和成长工作区刷新完成时结束。 */
async function updateFeedbackSourceStatus(input: { ids: string[], isEnabled: boolean }): Promise<void> {
  await runAction(input.isEnabled ? '所选反馈资料已启用' : '所选反馈资料已禁用', async () => {
    await $fetch(`/api/v1/personas/${personaId}/feedback-sources/status`, { method: 'PATCH', body: input })
    await refreshGrowth()
  })
}

/** @param input 待永久删除的反馈资料。 @returns 删除和成长工作区刷新完成时结束。 */
async function deleteFeedbackSources(input: { ids: string[] }): Promise<void> {
  await runAction('所选反馈资料已删除；已确认成长保持不变', async () => {
    await $fetch(`/api/v1/personas/${personaId}/feedback-sources`, { method: 'DELETE', body: input })
    await refreshGrowth()
  })
}

/** @param input 人工成长候选。 @returns 创建和成长工作区刷新完成时结束。 */
async function createGrowth(input: { content: string, scope: string, importance: number, sourceIds: string[] }): Promise<void> {
  await runAction('成长候选已创建，确认前不会进入任务', async () => {
    await $fetch(`/api/v1/personas/${personaId}/growth`, { method: 'POST', body: input })
    await refreshGrowth()
  })
}

/** @param input 成长批量目标状态。 @returns 审核和成长工作区刷新完成时结束。 */
async function updateGrowthStatus(input: { ids: string[], status: 'active' | 'archived' | 'rejected' }): Promise<void> {
  await runAction('人物成长状态已更新', async () => {
    await $fetch(`/api/v1/personas/${personaId}/growth/status`, { method: 'PATCH', body: input })
    await refreshGrowth()
  })
}

/** @param input 处理记录批量启用状态。 @returns 更新和记忆工作区刷新完成时结束。 */
async function updateOperationRecordStatus(input: { ids: string[], isEnabled: boolean }): Promise<void> {
  await runAction(input.isEnabled ? '所选处理记录已参加记忆分析' : '所选处理记录已不参加记忆分析', async () => {
    await $fetch(`/api/v1/personas/${personaId}/operation-records`, { method: 'PATCH', body: input })
    await refreshMemory()
  })
}

/** @param input 记忆批量目标状态。 @returns 审核和记忆工作区刷新完成时结束。 */
async function updateMemoryStatus(input: { ids: string[], status: 'active' | 'archived' | 'rejected' }): Promise<void> {
  await runAction('人物记忆状态已更新', async () => {
    await $fetch(`/api/v1/personas/${personaId}/memories/status`, { method: 'PATCH', body: input })
    await refreshMemory()
  })
}

/** @param memoryId 记忆 UUID。 @returns 转换和两个工作区刷新完成时结束。 */
async function convertMemoryToFeedbackSource(memoryId: string): Promise<void> {
  await runAction('记忆已复制为人物反馈资料，尚未自动形成成长', async () => {
    await $fetch(`/api/v1/personas/${personaId}/memories/${memoryId}/to-feedback-source`, { method: 'POST' })
    await Promise.all([refreshGrowth(), refreshMemory()])
  })
}

/** @param target 成长或记忆。 @param mode 增量或完整重建。 @returns 批次创建和状态刷新完成时结束。 */
async function analyzeLearning(target: 'growth' | 'memory', mode: 'incremental' | 'full_rebuild'): Promise<void> {
  await runAction('分析任务已排队；稍后刷新状态查看 AI 提案', async () => {
    const path = target === 'growth' ? 'growth' : 'memories'
    await $fetch(`/api/v1/personas/${personaId}/${path}/analyze`, { method: 'POST', body: { mode } })
    await (target === 'growth' ? refreshGrowthAnalysis() : refreshMemoryAnalysis())
  })
}

/** @param target 成长或记忆。 @param decision 单项人工审核。 @returns 应用和相关工作区刷新完成时结束。 */
async function reviewAnalysisProposal(target: 'growth' | 'memory', decision: {
  proposalId: string
  action: 'accept' | 'reject'
  reviewed?: ProposedLearningContentView | null
}): Promise<void> {
  const batch = target === 'growth' ? growthAnalysis.value : memoryAnalysis.value
  if (!batch) return
  await runAction(decision.action === 'accept' ? '提案已人工确认并应用' : '提案已拒绝', async () => {
    await $fetch(`/api/v1/analysis-batches/${batch.id}/review`, { method: 'POST', body: { decisions: [decision] } })
    if (target === 'growth') await Promise.all([refreshGrowthAnalysis(), refreshGrowth()])
    else await Promise.all([refreshMemoryAnalysis(), refreshMemory()])
  })
}

/**
 * 查询永久删除人物的影响范围。
 * @returns 查询完成时结束。
 */
async function inspectDeletion(): Promise<void> {
  await runAction(null, async () => {
    const response = await $fetch<ApiResponse<DeletionImpact>>(`/api/v1/personas/${personaId}/deletion-impact`)
    deletionImpact.value = response.data
    deletionConfirmed.value = false
  })
}

/**
 * 在用户明确确认后永久删除人物。
 * @returns 删除和导航完成时结束。
 */
async function deletePersona(): Promise<void> {
  if (!deletionConfirmed.value || !deletionImpact.value?.canDelete) return
  await runAction(null, async () => {
    await $fetch(`/api/v1/personas/${personaId}`, { method: 'DELETE' })
    await navigateTo('/personas')
  })
}

/**
 * 统一管理页面动作状态和通俗反馈。
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
    <ContentPageHeader
      :title="details?.persona.name || '人物工作区'"
      :description="details?.persona.currentSummary || '灵魂、成长和记忆的长期内容都需要人工确认后才会影响新任务。'"
    >
      <UButton to="/personas" color="neutral" variant="ghost">返回人物列表</UButton>
      <UButton v-if="details?.persona.activeVersionId" to="/workbench">新建任务</UButton>
    </ContentPageHeader>

    <UAlert v-if="error || !details || !soul" color="error" title="人物工作区加载失败" :actions="[{ label: '重试', onClick: () => Promise.all([refresh(), refreshSoul()]) }]" />
    <template v-else>
      <UAlert v-if="actionError" class="mb-5" color="error" title="操作失败" :description="actionError" />
      <UAlert v-if="actionMessage" class="mb-5" color="success" title="操作完成" :description="actionMessage" />

      <div class="mb-6 grid gap-px overflow-hidden rounded-lg border border-default bg-default sm:grid-cols-4">
        <div class="bg-default p-4"><p class="text-xs text-muted">所属世界</p><p class="mt-1 font-medium text-highlighted">{{ details.persona.worldName || '未关联世界' }}</p></div>
        <div class="bg-default p-4"><p class="text-xs text-muted">当前灵魂</p><p class="mt-1 font-medium text-highlighted">{{ soul.activeVersion ? '已发布，可用于任务' : '尚未发布' }}</p></div>
        <div class="bg-default p-4"><p class="text-xs text-muted">参考资料</p><p class="mt-1 font-medium text-highlighted">{{ details.sources.length }} 项</p></div>
        <div class="bg-default p-4"><p class="text-xs text-muted">待确认修改</p><p class="mt-1 font-medium text-highlighted">{{ soul.draft ? '1 份灵魂修改稿' : '没有灵魂修改稿' }}</p></div>
      </div>

      <nav class="mind-tabs mb-6" aria-label="人物工作区标签">
        <button v-for="tab in tabs" :key="tab.id" class="mind-tab" :aria-selected="selectedTab === tab.id" @click="selectTab(tab.id)">{{ tab.label }}</button>
      </nav>

      <div v-if="selectedTab === 'overview'" class="grid gap-6 xl:grid-cols-2">
        <UCard>
          <template #header><h2 class="font-semibold text-highlighted">当前人物状态</h2></template>
          <p class="whitespace-pre-wrap text-sm leading-6 text-muted">{{ soul.activeVersion?.snapshot.runtimeSummary || '人物还没有发布灵魂。完善并发布灵魂后，才能稳定模拟这个人物。' }}</p>
          <UButton class="mt-4" color="neutral" variant="soft" @click="selectTab('soul')">查看和编辑灵魂</UButton>
        </UCard>
        <UCard>
          <template #header><h2 class="font-semibold text-highlighted">变化边界</h2></template>
          <div class="space-y-3 text-sm text-muted">
            <p>成长来自你明确提供的人物反馈资料，确认前不会生效。</p>
            <p>记忆来自人物多次有效处理记录，单次输出不会直接形成稳定记忆。</p>
            <p>成长和记忆不会自动改写灵魂；吸收后仍需发布新灵魂。</p>
          </div>
        </UCard>
      </div>

      <ContentSoulWorkspace
        v-else-if="selectedTab === 'soul'"
        :workspace="soul"
        :loading="actionLoading"
        @save="saveSoulDraft"
        @publish="publishSoul"
        @delete="deleteSoulDraft"
        @from-version="createDraftFromVersion"
      />

      <div v-else-if="selectedTab === 'growth'" class="space-y-6">
        <AnalysisAnalysisPanel
          title="人物成长"
          :batch="growthAnalysis"
          :loading="actionLoading"
          @analyze="analyzeLearning('growth', $event)"
          @refresh="refreshGrowthAnalysis"
          @review="reviewAnalysisProposal('growth', $event)"
        />
        <div class="grid items-start gap-6 xl:grid-cols-2">
          <LearningPersonaFeedbackSourcePanel
          :items="growthWorkspace.feedbackSources"
          :loading="actionLoading"
          @create="createFeedbackSource"
          @status="updateFeedbackSourceStatus"
          @delete="deleteFeedbackSources"
        />
          <LearningGrowthRecordPanel
          subject-label="人物"
          :items="growthWorkspace.growth"
          :sources="growthWorkspace.feedbackSources.map(item => ({ id: item.id, label: item.title }))"
          :loading="actionLoading"
          @create="createGrowth"
          @status="updateGrowthStatus"
          />
        </div>
      </div>

      <div v-else-if="selectedTab === 'memory'" class="space-y-6">
        <AnalysisAnalysisPanel
          title="人物记忆"
          :batch="memoryAnalysis"
          :loading="actionLoading"
          @analyze="analyzeLearning('memory', $event)"
          @refresh="refreshMemoryAnalysis"
          @review="reviewAnalysisProposal('memory', $event)"
        />
        <div class="grid items-start gap-6 xl:grid-cols-2">
          <LearningOperationRecordPanel :items="memoryWorkspace.operationRecords" :loading="actionLoading" @status="updateOperationRecordStatus" />
          <LearningMemoryRecordPanel :items="memoryWorkspace.memories" :loading="actionLoading" @status="updateMemoryStatus" @convert="convertMemoryToFeedbackSource" />
        </div>
      </div>

      <div v-else class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="space-y-6">
          <UCard>
            <template #header><div><h2 class="font-semibold text-highlighted">基本信息</h2><p class="mt-1 text-sm text-muted">名称用于后台辨认；所属世界的已发布灵魂会进入人物的新任务。</p></div></template>
            <UForm :schema="updatePersonaSchema" :state="metadata" class="grid gap-4 md:grid-cols-2" @submit="saveMetadata">
              <UFormField name="name" label="人物名称" required><UInput v-model="metadata.name" class="w-full" /></UFormField>
              <UFormField name="worldId" label="所属世界">
                <select v-model="metadata.worldId" class="native-control"><option :value="null">不关联世界</option><option v-for="world in worlds" :key="world.id" :value="world.id">{{ world.name }}</option></select>
              </UFormField>
              <div class="md:col-span-2"><UButton type="submit" :loading="actionLoading">保存基本信息</UButton></div>
            </UForm>
          </UCard>
          <UCard>
            <template #header><div><h2 class="font-semibold text-highlighted">参考资料</h2><p class="mt-1 text-sm text-muted">普通参考资料帮助当前任务取证，不会自动变成人物成长。</p></div></template>
            <div v-if="details.sources.length" class="grid gap-3 sm:grid-cols-2">
              <NuxtLink v-for="source in details.sources" :key="source.id" :to="`/sources/${source.id}`" class="rounded-lg border border-default p-3"><p class="font-medium text-highlighted">{{ source.name }}</p><p class="mt-1 line-clamp-2 text-sm text-muted">{{ source.contentText }}</p></NuxtLink>
            </div>
            <p v-else class="text-sm text-muted">当前没有直接关联的参考资料。</p>
          </UCard>
        </div>
        <UCard>
          <template #header><h2 class="font-semibold text-error">删除人物</h2></template>
          <UButton v-if="!deletionImpact" color="error" variant="soft" :loading="actionLoading" @click="inspectDeletion">先查看会删除什么</UButton>
          <div v-else class="space-y-3 text-sm">
            <p>将删除 {{ deletionImpact.versionCount }} 个灵魂版本和 {{ deletionImpact.runHistory.runs }} 次历史任务。</p>
            <UCheckbox v-model="deletionConfirmed" label="我确认永久删除这个人物" />
            <UButton color="error" :disabled="!deletionConfirmed" :loading="actionLoading" @click="deletePersona">永久删除人物</UButton>
          </div>
        </UCard>
      </div>
    </template>
  </div>
</template>
