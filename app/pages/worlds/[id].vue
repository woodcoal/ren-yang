<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, shallowRef } from 'vue'
import type { CreateSourceWithTargetsInput, SaveSoulVersionInput, UpdateWorldInput } from '#shared/schemas/content'
import { updateWorldSchema } from '#shared/schemas/content'
import type {
  CreateGrowthMaterialInput,
  ImportGrowthSourcesInput,
  SaveLearningPromptDraftInput,
  UpdateGrowthMaterialInput,
} from '#shared/schemas/learning'
import type { ApiResponse } from '#shared/types/api'
import type { DeletionImpact, PersonaSummary, SoulWorkspaceView, SourceDetails, SourceSummary, WorldDetails } from '#shared/types/content'
import type { WorldGrowthWorkspaceView } from '#shared/types/learning'
import type { AnalysisBatchView } from '#shared/types/analysis'
import type { SourceFileSubmission } from '../../components/content/SourceImportForm.vue'
import GrowthMaterialPanel from '../../components/learning/GrowthMaterialPanel.vue'
import LearningPromptPanel from '../../components/learning/LearningPromptPanel.vue'
import { getApiErrorMessage } from '../../utils/apiError'

type WorldTab = 'basic' | 'prompts' | 'materials' | 'operations'
type WorldPromptModule = 'soul' | 'growth'
type WorldMaterialModule = 'sources' | 'growth_materials'

const worldId = String(useRoute().params.id)
const { runWithAiLoading } = useAiLoading()
const [
  { data, error, refresh },
  { data: soulData, refresh: refreshSoul },
  { data: sourceData, refresh: refreshSources },
  { data: growthData, refresh: refreshGrowth },
  { data: analysisData, refresh: refreshAnalysis },
  { data: personaData, error: personaError, refresh: refreshPersonas },
] = await Promise.all([
  useFetch<ApiResponse<WorldDetails>>(`/api/v1/worlds/${worldId}`),
  useFetch<ApiResponse<SoulWorkspaceView>>(`/api/v1/worlds/${worldId}/soul`),
  useFetch<ApiResponse<SourceSummary[]>>('/api/v1/sources'),
  useFetch<ApiResponse<WorldGrowthWorkspaceView>>(`/api/v1/worlds/${worldId}/growth`),
  useFetch<ApiResponse<AnalysisBatchView | null>>('/api/v1/analysis-batches/latest', { query: { analysisType: 'world_growth', subjectId: worldId } }),
  useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas'),
])

const details = computed(() => data.value?.data ?? null)
const soul = computed(() => soulData.value?.data ?? null)
const allSources = computed(() => sourceData.value?.data ?? [])
const growthWorkspace = computed<WorldGrowthWorkspaceView>(() => growthData.value?.data ?? {
  sources: [], materials: [],
  prompt: { promptType: 'world_growth', activeVersion: null, draft: null, versions: [] },
})
const growthAnalysis = computed(() => analysisData.value?.data ?? null)
const allPersonas = computed(() => personaData.value?.data ?? [])
const tabs: Array<{ id: WorldTab, label: string }> = [
  { id: 'basic', label: '基础信息' },
  { id: 'prompts', label: '提示词' },
  { id: 'materials', label: '资料' },
  { id: 'operations', label: '操作' },
]
const promptModules: Array<{ id: WorldPromptModule, label: string, description: string }> = [
  { id: 'soul', label: '灵魂', description: '稳定的世界规则、基调与事实边界。' },
  { id: 'growth', label: '成长', description: '从成长素材提炼出的世界变化与经验。' },
]
const materialModules: Array<{ id: WorldMaterialModule, label: string, description: string }> = [
  { id: 'sources', label: '任务参考', description: '任务执行时可检索的世界相关资料。' },
  { id: 'growth_materials', label: '成长素材', description: '用于生成世界成长提示词的原始材料。' },
]
const selectedTab = shallowRef<WorldTab>('basic')
const selectedPromptModule = shallowRef<WorldPromptModule>('soul')
const selectedMaterialModule = shallowRef<WorldMaterialModule>('sources')
const metadata = reactive<UpdateWorldInput>({
  name: details.value?.world.name ?? '',
  summary: details.value?.world.summary ?? '',
})
const deletionImpact = shallowRef<DeletionImpact | null>(null)
const { notifySuccess, notifyError, notifyWarning } = useOperationNotifications()
const actionLoading = shallowRef(false)
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
 * 保存世界灵魂并立即生成新的当前历史版本。
 * @param input 当前编辑文本和历史基线。
 * @returns 保存、详情和历史刷新完成时结束。
 */
async function saveSoulVersion(input: SaveSoulVersionInput): Promise<void> {
  await runAction('世界灵魂已保存，之后创建的新任务将使用这一版', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/soul`, { method: 'PUT', body: input })
    await Promise.all([refresh(), refreshSoul()])
  })
}

/**
 * 按逐条人工评分把世界资料库内容批量复制为成长素材。
 * @param input 资料 UUID 与 AI 提炼评分。
 * @returns 整批导入和成长素材池刷新完成时结束。
 */
async function importWorldGrowthSources(input: ImportGrowthSourcesInput): Promise<void> {
  await runAction(`已从资料库导入 ${input.items.length} 项世界成长素材`, async () => {
    await $fetch(`/api/v1/worlds/${worldId}/growth/import`, { method: 'POST', body: input })
    await refreshGrowth()
  })
}

/**
 * 手工添加只用于世界成长提炼的独立文档。
 * @param input 素材标题、完整正文和评分。
 * @returns 添加和成长素材池刷新完成时结束。
 */
async function createWorldGrowthMaterial(input: CreateGrowthMaterialInput): Promise<void> {
  await runAction('手工文档已加入世界成长素材池', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/growth`, { method: 'POST', body: input })
    await refreshGrowth()
  })
}

/**
 * 修改世界成长素材的固定标题、正文快照和评分。
 * @param input 素材 UUID 与完整新内容。
 * @returns 修改和成长素材池刷新完成时结束。
 */
async function updateWorldGrowthMaterial(input: UpdateGrowthMaterialInput & { id: string }): Promise<void> {
  await runAction('世界成长素材已修改', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/growth/${input.id}`, {
      method: 'PATCH',
      body: { title: input.title, content: input.content, importance: input.importance },
    })
    await refreshGrowth()
  })
}

/** @param input 世界成长素材批量启用状态。 @returns 更新和成长素材池刷新完成时结束。 */
async function updateWorldGrowthMaterialStatus(input: { ids: string[], isEnabled: boolean }): Promise<void> {
  await runAction(input.isEnabled ? '所选成长素材已参加提炼' : '所选成长素材已不参加提炼', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/growth/status`, { method: 'PATCH', body: input })
    await refreshGrowth()
  })
}

/**
 * 永久删除所选世界成长素材快照。
 * @param input 待删除素材 UUID 集合。
 * @returns 删除和成长素材池刷新完成时结束。
 */
async function deleteWorldGrowthMaterials(input: { ids: string[] }): Promise<void> {
  await runAction('所选世界成长素材已删除', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/growth`, { method: 'DELETE', body: input })
    await refreshGrowth()
  })
}

/** @param mode 结合新增素材或完整重建。 @returns 批次创建和状态刷新完成时结束。 */
async function analyzeWorldGrowth(mode: 'incremental' | 'full_rebuild'): Promise<void> {
  await runAction('世界成长提炼任务已排队；完成后会生成待校准草稿', async () => {
    await runWithAiLoading({
      title: 'AI 正在启动世界成长提炼',
      description: mode === 'incremental' ? '系统正在结合新增素材生成完整提示词草稿。' : '系统正在从全部启用素材重新生成完整提示词草稿。',
      completionHint: '任务进入队列后会返回当前页面，可稍后刷新查看草稿。',
    }, async () => await $fetch(`/api/v1/worlds/${worldId}/growth/analyze`, { method: 'POST', body: { mode } }))
    await refreshAnalysis()
  })
}

/** @returns 同步刷新世界成长提炼状态和提示词草稿时结束。 */
async function refreshWorldGrowthAnalysis(): Promise<void> {
  // 先读取批次状态，再读取草稿，避免 Worker 恰好完成时页面短暂显示已完成但没有草稿。
  await refreshAnalysis()
  await refreshGrowth()
}

/**
 * 保存完整世界成长提示词，并立即发布为后续任务使用的新版本。
 * @param input 完整提示词正文与历史基线。
 * @returns 草稿保存、发布和世界成长工作区刷新完成时结束。
 */
async function saveAndPublishWorldGrowthPrompt(input: SaveLearningPromptDraftInput): Promise<void> {
  await runAction('世界成长提示词已发布，之后创建的新任务将固定使用这一版', async () => {
    await $fetch(`/api/v1/worlds/${worldId}/growth/prompt/draft`, { method: 'PUT', body: input })
    await $fetch(`/api/v1/worlds/${worldId}/growth/prompt/publish`, {
      method: 'POST',
      body: { changeSummary: '保存并发布校准后的提示词' },
    })
    await refreshGrowth()
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
      // 成长资料选择器使用独立请求，资料关系变化后必须同步刷新，避免标签切换后仍显示旧列表。
      await Promise.all([refresh(), refreshSources(), refreshGrowth()])
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
    await Promise.all([refresh(), refreshSources(), refreshGrowth()])
  })
}

/**
 * 把尚未归属世界的人物加入当前世界。
 * @param persona 待关联的人物摘要。
 * @returns 关系更新和列表刷新完成时结束。
 */
async function addPersona(persona: PersonaSummary): Promise<void> {
  await updatePersonaWorld(persona, worldId, `人物“${persona.name}”已加入这个世界`)
}

/**
 * 解除人物与当前世界的关系，不删除人物及其任何数据。
 * @param persona 待解除关联的人物摘要。
 * @returns 关系更新和列表刷新完成时结束。
 */
async function removePersona(persona: PersonaSummary): Promise<void> {
  await updatePersonaWorld(persona, null, `人物“${persona.name}”已移出这个世界，人物本身仍保留`)
}

/**
 * 复用人物元数据接口修改世界指针，并同步刷新世界详情与人物候选。
 * @param persona 待修改的人物摘要。
 * @param targetWorldId 目标世界 UUID；null 表示解除世界关系。
 * @param successMessage 操作成功后展示的消息。
 * @returns 请求和刷新全部完成时结束。
 */
async function updatePersonaWorld(persona: PersonaSummary, targetWorldId: string | null, successMessage: string): Promise<void> {
  await runAction(successMessage, async () => {
    await $fetch(`/api/v1/personas/${persona.id}`, {
      method: 'PATCH',
      body: { name: persona.name, worldId: targetWorldId },
    })
    await Promise.all([refresh(), refreshPersonas()])
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
    await Promise.all([refresh(), refreshSources(), refreshGrowth()])
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
    await Promise.all([refresh(), refreshSources(), refreshGrowth()])
  })
}

/**
 * 逐个上传文件资料并在同一资料事务中关联当前世界。
 * @param input 共用用途和带独立名称的文件列表。
 * @returns 全部文件处理和页面刷新完成时结束。
 */
async function importSourceFile(input: SourceFileSubmission): Promise<void> {
  actionLoading.value = true
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
    if (succeeded > 0) await Promise.all([refresh(), refreshSources(), refreshGrowth()])
    if (failures.length > 0) {
      notifyWarning(`成功 ${succeeded} 个，失败 ${failures.length} 个。${failures.join('；')}`, '资料导入部分完成')
    }
    else {
      notifySuccess(`${succeeded} 个新资料已创建并加入这个世界`, '资料导入完成')
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
  })
}

/**
 * 在用户确认后永久删除世界。
 * @returns 删除和导航完成时结束。
 */
async function deleteWorld(): Promise<void> {
  if (!deletionImpact.value?.canDelete) return
  await runAction('世界已永久删除', async () => {
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
 * 重新加载世界详情、灵魂工作区与人物候选列表。
 * @returns 三项读取请求全部结束时完成。
 */
async function retryWorldWorkspace(): Promise<void> {
  await Promise.all([refresh(), refreshSoul(), refreshPersonas()])
}

/**
 * 统一管理页面动作状态与通俗反馈。
 * @param successMessage 成功提示；不需要时为 null。
 * @param action 当前异步动作。
 * @returns 动作结束且等待状态恢复时完成。
 */
async function runAction(successMessage: string | null, action: () => Promise<void>): Promise<void> {
  actionLoading.value = true
  try {
    await action()
    if (successMessage) notifySuccess(successMessage)
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, '操作失败'))
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
      <UButton to="/worlds" color="neutral" variant="ghost">返回世界列表</UButton>
    </ContentPageHeader>

    <UAlert v-if="error || personaError || !details || !soul" color="error" title="世界工作区加载失败"
      :actions="[{ label: '重试', onClick: retryWorldWorkspace }]" />
    <template v-else>
      <UAlert v-if="!details.world.isEnabled" class="mb-6" color="warning" title="世界当前已禁用"
        description="世界版本、人物关系、资料和历史任务仍会保留，但该世界不会进入后续新任务。" />

      <div class="status-strip page-status-strip mb-6">
        <div class="status-cell"><span class="status-kicker">关联人物</span><strong class="status-value">{{
          details.personas.length }} 个</strong></div>
        <div class="status-cell"><span class="status-kicker">当前灵魂</span><strong class="status-value">已保存并使用</strong></div>
        <div class="status-cell"><span class="status-kicker">世界资料</span><strong class="status-value">{{
          details.sources.length }} 项</strong></div>
        <div class="status-cell"><span class="status-kicker">提示词历史</span><strong class="status-value">{{
          soul.versions.length }} 个版本</strong></div>
      </div>

      <nav class="mind-tabs mb-6" aria-label="世界工作区标签">
        <button v-for="tab in tabs" :key="tab.id" class="mind-tab" :aria-selected="selectedTab === tab.id"
          @click="selectTab(tab.id)">{{ tab.label }}</button>
      </nav>

      <div v-if="selectedTab === 'basic'" class="space-y-6">
        <UCard>
          <template #header>
            <div>
              <h2 class="font-semibold text-highlighted">基本信息</h2>
              <p class="mt-1 text-sm text-muted">名称和简介只方便后台辨认，不会进入提示词。</p>
            </div>
          </template>
          <UForm :schema="updateWorldSchema" :state="metadata" class="grid gap-4 md:grid-cols-2" @submit="saveMetadata">
            <UFormField name="name" label="世界名称" required><UInput v-model="metadata.name" class="w-full" /></UFormField>
            <UFormField name="summary" label="后台简介"><UInput v-model="metadata.summary" class="w-full" /></UFormField>
            <div class="md:col-span-2"><UButton type="submit" :loading="actionLoading">保存基本信息</UButton></div>
          </UForm>
        </UCard>
        <ContentWorldPersonaList
          :personas="details.personas"
          :available-personas="allPersonas"
          :loading="actionLoading"
          @add="addPersona"
          @remove="removePersona"
        />
      </div>

      <div v-else-if="selectedTab === 'prompts'">
        <ContentWorkspaceModuleNav v-model="selectedPromptModule" :items="promptModules" ariaLabel="世界提示词模块" />
        <ContentSoulWorkspace
          v-if="selectedPromptModule === 'soul'"
          :workspace="soul"
          :loading="actionLoading"
          @save="saveSoulVersion"
        />
        <LearningPromptPanel
          v-else-if="selectedPromptModule === 'growth'"
          title="世界成长"
          :workspace="growthWorkspace.prompt"
          :batch="growthAnalysis"
          :loading="actionLoading"
          @analyze="analyzeWorldGrowth"
          @refresh="refreshWorldGrowthAnalysis"
          @save-and-publish="saveAndPublishWorldGrowthPrompt"
        />
      </div>

      <div v-else-if="selectedTab === 'materials'">
        <ContentWorkspaceModuleNav v-model="selectedMaterialModule" :items="materialModules" ariaLabel="世界资料模块" />
        <ContentSubjectSourceManager
          v-if="selectedMaterialModule === 'sources'"
          subject-type="world"
          :subject-name="details.world.name"
          :linked-sources="details.sources"
          :all-sources="allSources"
          :loading="actionLoading"
          :error-message="null"
          @link="linkSources"
          @unlink="unlinkSource"
          @status="updateLinkedSourceStatus"
          @paste="createPastedSource"
          @file="importSourceFile"
        />
        <GrowthMaterialPanel
          v-else-if="selectedMaterialModule === 'growth_materials'"
          subject-label="世界"
          :items="growthWorkspace.materials"
          :sources="growthWorkspace.sources"
          :loading="actionLoading"
          @import-sources="importWorldGrowthSources"
          @create="createWorldGrowthMaterial"
          @update="updateWorldGrowthMaterial"
          @status="updateWorldGrowthMaterialStatus"
          @delete="deleteWorldGrowthMaterials"
        />
      </div>

      <ContentLifecycleOperationsPanel
        v-else
        subject-type="world"
        :subject-name="details.world.name"
        :is-enabled="details.world.isEnabled"
        :deletion-impact="deletionImpact"
        :loading="actionLoading"
        @request-status-change="requestWorldStatusChange"
        @inspect-deletion="inspectDeletion"
        @delete="deleteWorld"
      />
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
