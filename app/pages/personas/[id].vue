<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, shallowRef } from 'vue'
import type { CreateSourceWithTargetsInput, PersonaCredentialInput, SaveSoulVersionInput, UpdatePersonaInput } from '#shared/schemas/content'
import { updatePersonaSchema } from '#shared/schemas/content'
import type {
  CreateGrowthMaterialInput,
  ImportGrowthSourcesInput,
  SaveExternalRecordInput,
  SaveLearningPromptDraftInput,
  UpdateGrowthMaterialInput,
  UpdateOperationRecordInput,
} from '#shared/schemas/learning'
import type { ApiResponse } from '#shared/types/api'
import type { DeletionImpact, PersonaCredentialSecretView, PersonaDetails, SoulWorkspaceView, SourceDetails, SourceSummary, WorldSummary } from '#shared/types/content'
import type { PersonaGrowthWorkspaceView, PersonaMemoryWorkspaceView } from '#shared/types/learning'
import type { AnalysisBatchView } from '#shared/types/analysis'
import type { SourceFileSubmission } from '../../components/content/SourceImportForm.vue'
import GrowthMaterialPanel from '../../components/learning/GrowthMaterialPanel.vue'
import LearningPromptPanel from '../../components/learning/LearningPromptPanel.vue'
import { getApiErrorMessage } from '../../utils/apiError'

type PersonaTab = 'basic' | 'prompts' | 'materials' | 'operations'
type PersonaPromptModule = 'soul' | 'growth' | 'memory'
type PersonaMaterialModule = 'sources' | 'growth_materials' | 'records' | 'external_records'

const personaId = String(useRoute().params.id)
const { runWithAiLoading } = useAiLoading()
const [
  { data, error, refresh },
  { data: soulData, refresh: refreshSoul },
  { data: worldData },
  { data: sourceData, refresh: refreshSources },
  { data: growthData, refresh: refreshGrowth },
  { data: memoryData, refresh: refreshMemory },
  { data: growthAnalysisData, refresh: refreshGrowthAnalysis },
  { data: memoryAnalysisData, refresh: refreshMemoryAnalysis },
] = await Promise.all([
  useFetch<ApiResponse<PersonaDetails>>(`/api/v1/personas/${personaId}`),
  useFetch<ApiResponse<SoulWorkspaceView>>(`/api/v1/personas/${personaId}/soul`),
  useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds'),
  useFetch<ApiResponse<SourceSummary[]>>('/api/v1/sources'),
  useFetch<ApiResponse<PersonaGrowthWorkspaceView>>(`/api/v1/personas/${personaId}/growth`),
  useFetch<ApiResponse<PersonaMemoryWorkspaceView>>(`/api/v1/personas/${personaId}/memories`),
  useFetch<ApiResponse<AnalysisBatchView | null>>('/api/v1/analysis-batches/latest', { query: { analysisType: 'persona_growth', subjectId: personaId } }),
  useFetch<ApiResponse<AnalysisBatchView | null>>('/api/v1/analysis-batches/latest', { query: { analysisType: 'persona_memory', subjectId: personaId } }),
])

const details = computed(() => data.value?.data ?? null)
const soul = computed(() => soulData.value?.data ?? null)
const worlds = computed(() => worldData.value?.data ?? [])
const allSources = computed(() => sourceData.value?.data ?? [])
const growthWorkspace = computed<PersonaGrowthWorkspaceView>(() => growthData.value?.data ?? {
  sources: [], materials: [],
  prompt: { promptType: 'persona_growth', activeVersion: null, draft: null, versions: [] },
  inputStatistics: { enabledCount: 0, pendingCount: 0 },
})
const memoryWorkspace = computed<PersonaMemoryWorkspaceView>(() => memoryData.value?.data ?? {
  operationRecords: [], externalRecords: [],
  prompt: { promptType: 'persona_memory', activeVersion: null, draft: null, versions: [] },
  inputStatistics: { enabledCount: 0, pendingCount: 0 },
})
const growthAnalysis = computed(() => growthAnalysisData.value?.data ?? null)
const memoryAnalysis = computed(() => memoryAnalysisData.value?.data ?? null)
const tabs: Array<{ id: PersonaTab, label: string }> = [
  { id: 'basic', label: '基础信息' },
  { id: 'prompts', label: '提示词' },
  { id: 'materials', label: '资料' },
  { id: 'operations', label: '操作' },
]
const promptModules: Array<{ id: PersonaPromptModule, label: string, description: string }> = [
  { id: 'soul', label: '灵魂', description: '稳定的人物身份、价值观与行为边界。' },
  { id: 'growth', label: '成长', description: '从成长素材提炼出的经验与个性变化。' },
  { id: 'memory', label: '记忆', description: '从历史任务和三方记录提炼出的长期记忆。' },
]
const materialModules: Array<{ id: PersonaMaterialModule, label: string, description: string }> = [
  { id: 'sources', label: '任务参考', description: '任务执行时可检索的相关资料。' },
  { id: 'growth_materials', label: '成长素材', description: '用于生成成长提示词的原始材料。' },
  { id: 'records', label: '历史任务', description: '人物实际执行过的任务记录。' },
  { id: 'external_records', label: '三方记录', description: '手工补充的外部经历与参考地址。' },
]
const selectedTab = shallowRef<PersonaTab>('basic')
const selectedPromptModule = shallowRef<PersonaPromptModule>('soul')
const selectedMaterialModule = shallowRef<PersonaMaterialModule>('sources')
const metadata = reactive<UpdatePersonaInput>({
  name: details.value?.persona.name ?? '',
  worldId: details.value?.persona.worldId ?? null,
})
const deletionImpact = shallowRef<DeletionImpact | null>(null)
const { notifySuccess, notifyError, notifyWarning } = useOperationNotifications()
const actionLoading = shallowRef(false)
/** 只有用户主动查看后才暂存在当前页面内存中的密码和账号信息。 */
const revealedCredential = shallowRef<PersonaCredentialSecretView | null>(null)
/** 头像更新后用于强制刷新页首同地址图片。 */
const avatarRevision = shallowRef(0)
const enableConfirmationOpen = shallowRef(false)
const disableConfirmationOpen = shallowRef(false)
/** 页首头像读取地址；每次更新增加版本查询参数，避免浏览器继续显示旧图。 */
const headerAvatarUrl = computed(() => details.value?.persona.avatarUrl
  ? `${details.value.persona.avatarUrl}?v=${avatarRevision.value}`
  : null)

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
 * 主动请求服务端解密当前人物密码，仅在当前页面内存中短暂展示。
 * @returns 账号信息加载完成时结束。
 */
async function revealCredential(): Promise<void> {
  await runAction('已读取当前密码；离开或刷新页面后会自动隐藏', async () => {
    const response = await $fetch<ApiResponse<PersonaCredentialSecretView>>(`/api/v1/personas/${personaId}/credentials`)
    revealedCredential.value = response.data
  })
}

/**
 * 清除当前页面内存中的密码原文并恢复密码遮罩。
 * @returns 明文引用清除时结束。
 */
function concealCredential(): void {
  revealedCredential.value = null
}

/**
 * 保存人物可选账号信息，并清除页面中的密码明文。
 * @param input 三项分别可选的账号、邮箱和密码。
 * @returns 保存与人物详情刷新完成时结束。
 */
async function saveCredential(input: PersonaCredentialInput): Promise<void> {
  await runAction('账号信息已保存', async () => {
    await $fetch(`/api/v1/personas/${personaId}/credentials`, { method: 'PUT', body: input })
    revealedCredential.value = null
    await refresh()
  })
}

/**
 * 头像上传或生成成功后刷新人物详情。
 * @returns 最新人物摘要加载完成时结束。
 */
async function refreshPersonaAvatar(): Promise<void> {
  avatarRevision.value += 1
  await refresh()
}

/**
 * 保存人物灵魂并立即生成新的当前历史版本。
 * @param input 当前编辑文本和历史基线。
 * @returns 保存、详情和历史刷新完成时结束。
 */
async function saveSoulVersion(input: SaveSoulVersionInput): Promise<void> {
  await runAction('人物灵魂已保存，之后创建的新任务将使用这一版', async () => {
    await $fetch(`/api/v1/personas/${personaId}/soul`, { method: 'PUT', body: input })
    await Promise.all([refresh(), refreshSoul()])
  })
}

/**
 * 按逐条人工评分把人物资料库内容批量复制为成长素材。
 * @param input 资料 UUID 与 AI 提炼评分。
 * @returns 整批导入和成长素材池刷新完成时结束。
 */
async function importGrowthSources(input: ImportGrowthSourcesInput): Promise<void> {
  await runAction(`已从资料库导入 ${input.items.length} 项成长素材`, async () => {
    await $fetch(`/api/v1/personas/${personaId}/growth/import`, { method: 'POST', body: input })
    await refreshGrowth()
  })
}

/**
 * 手工添加只用于成长提炼的独立文档。
 * @param input 素材标题、完整正文和评分。
 * @returns 添加和成长素材池刷新完成时结束。
 */
async function createGrowthMaterial(input: CreateGrowthMaterialInput): Promise<void> {
  await runAction('手工文档已加入人物成长素材池', async () => {
    await $fetch(`/api/v1/personas/${personaId}/growth`, { method: 'POST', body: input })
    await refreshGrowth()
  })
}

/**
 * 修改人物成长素材的固定标题、正文快照和评分。
 * @param input 素材 UUID 与完整新内容。
 * @returns 修改和成长素材池刷新完成时结束。
 */
async function updateGrowthMaterial(input: UpdateGrowthMaterialInput & { id: string }): Promise<void> {
  await runAction('人物成长素材已修改', async () => {
    await $fetch(`/api/v1/personas/${personaId}/growth/${input.id}`, {
      method: 'PATCH',
      body: { title: input.title, content: input.content, importance: input.importance },
    })
    await refreshGrowth()
  })
}

/** @param input 成长素材批量启用状态。 @returns 更新和成长素材池刷新完成时结束。 */
async function updateGrowthMaterialStatus(input: { ids: string[], isEnabled: boolean }): Promise<void> {
  await runAction(input.isEnabled ? '所选成长素材已参加提炼' : '所选成长素材已不参加提炼', async () => {
    await $fetch(`/api/v1/personas/${personaId}/growth/status`, { method: 'PATCH', body: input })
    await refreshGrowth()
  })
}

/**
 * 永久删除所选人物成长素材快照。
 * @param input 待删除素材 UUID 集合。
 * @returns 删除和成长素材池刷新完成时结束。
 */
async function deleteGrowthMaterials(input: { ids: string[] }): Promise<void> {
  await runAction('所选人物成长素材已删除', async () => {
    await $fetch(`/api/v1/personas/${personaId}/growth`, { method: 'DELETE', body: input })
    await refreshGrowth()
  })
}

/** @param input 处理记录批量启用状态。 @returns 更新和记忆工作区刷新完成时结束。 */
async function updateOperationRecordStatus(input: { ids: string[], isEnabled: boolean }): Promise<void> {
  await runAction(input.isEnabled ? '所选历史任务已参加记忆提炼' : '所选历史任务已不参加记忆提炼', async () => {
    await $fetch(`/api/v1/personas/${personaId}/operation-records`, { method: 'PATCH', body: input })
    await refreshMemory()
  })
}

/** @param input 历史任务 UUID 和新评分。 @returns 评分更新和记忆工作区刷新完成时结束。 */
async function updateOperationRecordImportance(input: UpdateOperationRecordInput & { id: string }): Promise<void> {
  await runAction('历史任务提炼评分已更新', async () => {
    await $fetch(`/api/v1/personas/${personaId}/operation-records/${input.id}`, {
      method: 'PATCH', body: { importance: input.importance },
    })
    await refreshMemory()
  })
}

/** @param input 新第三方经历记录。 @returns 创建和记忆工作区刷新完成时结束。 */
async function createExternalRecord(input: SaveExternalRecordInput): Promise<void> {
  await runAction('第三方记录已加入人物记忆素材池', async () => {
    await $fetch(`/api/v1/personas/${personaId}/external-records`, { method: 'POST', body: input })
    await refreshMemory()
  })
}

/** @param input 第三方记录 UUID 与完整新内容。 @returns 修改和记忆工作区刷新完成时结束。 */
async function updateExternalRecord(input: SaveExternalRecordInput & { id: string }): Promise<void> {
  await runAction('第三方记录已修改', async () => {
    await $fetch(`/api/v1/personas/${personaId}/external-records/${input.id}`, {
      method: 'PATCH',
      body: { occurredOn: input.occurredOn, content: input.content, references: input.references, importance: input.importance },
    })
    await refreshMemory()
  })
}

/** @param input 第三方记录批量启用状态。 @returns 更新和记忆工作区刷新完成时结束。 */
async function updateExternalRecordStatus(input: { ids: string[], isEnabled: boolean }): Promise<void> {
  await runAction(input.isEnabled ? '所选第三方记录已参加记忆提炼' : '所选第三方记录已不参加记忆提炼', async () => {
    await $fetch(`/api/v1/personas/${personaId}/external-records`, { method: 'PATCH', body: input })
    await refreshMemory()
  })
}

/** @param input 待永久删除的第三方记录 UUID 集合。 @returns 删除和记忆工作区刷新完成时结束。 */
async function deleteExternalRecords(input: { ids: string[] }): Promise<void> {
  await runAction('所选第三方记录已删除', async () => {
    await $fetch(`/api/v1/personas/${personaId}/external-records`, { method: 'DELETE', body: input })
    await refreshMemory()
  })
}

/** @param target 成长或记忆。 @param mode 结合新增素材或完整重建。 @returns 批次创建和状态刷新完成时结束。 */
async function analyzeLearning(target: 'growth' | 'memory', mode: 'incremental' | 'full_rebuild'): Promise<void> {
  await runAction('AI 提炼任务已排队；完成后会生成待校准草稿', async () => {
    const path = target === 'growth' ? 'growth' : 'memories'
    const targetLabel = target === 'growth' ? '成长' : '记忆'
    await runWithAiLoading({
      title: `AI 正在启动人物${targetLabel}提炼`,
      description: mode === 'incremental' ? '系统正在结合新增素材生成完整提示词草稿。' : '系统正在从全部启用素材重新生成完整提示词草稿。',
      completionHint: '任务进入队列后会返回当前页面，可稍后刷新查看草稿。',
    }, async () => await $fetch(`/api/v1/personas/${personaId}/${path}/analyze`, { method: 'POST', body: { mode } }))
    await (target === 'growth' ? refreshGrowthAnalysis() : refreshMemoryAnalysis())
  })
}

/** @param target 成长或记忆。 @returns 同步刷新分析状态和对应提示词草稿时结束。 */
async function refreshLearningAnalysis(target: 'growth' | 'memory'): Promise<void> {
  // 先读取批次状态，再读取草稿，避免 Worker 恰好完成时出现“已完成但编辑器仍为空”的竞态。
  if (target === 'growth') {
    await refreshGrowthAnalysis()
    await refreshGrowth()
  }
  else {
    await refreshMemoryAnalysis()
    await refreshMemory()
  }
}

/**
 * 保存完整人物成长或记忆提示词，并立即发布为后续任务使用的新版本。
 * @param target 成长或记忆。
 * @param input 完整提示词正文与历史基线。
 * @returns 草稿保存、发布和工作区刷新完成时结束。
 */
async function saveAndPublishLearningPrompt(target: 'growth' | 'memory', input: SaveLearningPromptDraftInput): Promise<void> {
  await runAction('提示词已发布，之后创建的新任务将固定使用这一版', async () => {
    const path = target === 'growth' ? 'growth' : 'memories'
    await $fetch(`/api/v1/personas/${personaId}/${path}/prompt/draft`, { method: 'PUT', body: input })
    await $fetch(`/api/v1/personas/${personaId}/${path}/prompt/publish`, {
      method: 'POST',
      body: { changeSummary: '保存并发布校准后的提示词' },
    })
    await (target === 'growth' ? refreshGrowth() : refreshMemory())
  })
}

/**
 * 把选中的已有资料依次关联到当前人物。
 * @param sourceIds 资料 UUID 列表。
 * @returns 全部关联和详情刷新完成时结束。
 */
async function linkSources(sourceIds: string[]): Promise<void> {
  await runAction(`${sourceIds.length} 项资料已加入这个人物`, async () => {
    try {
      for (const sourceId of sourceIds) {
        await $fetch(`/api/v1/sources/${sourceId}/links`, {
          method: 'POST',
          body: { targetType: 'persona', targetId: personaId, priority: 100 },
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
 * 解除资料与人物的关系，不删除资料正文。
 * @param sourceId 资料 UUID。
 * @returns 解除和详情刷新完成时结束。
 */
async function unlinkSource(sourceId: string): Promise<void> {
  await runAction('资料已移出这个人物，资料本身仍保留', async () => {
    await $fetch(`/api/v1/sources/${sourceId}/links/${encodeURIComponent(`persona:${personaId}`)}`, { method: 'DELETE' })
    await Promise.all([refresh(), refreshSources(), refreshGrowth()])
  })
}

/**
 * 修改资料全局启用状态，并刷新人物资料卡。
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
 * 创建粘贴文本资料并立即关联当前人物。
 * @param input 已校验资料输入。
 * @returns 创建和详情刷新完成时结束。
 */
async function createPastedSource(input: CreateSourceWithTargetsInput): Promise<void> {
  await runAction('新资料已创建并加入这个人物', async () => {
    await $fetch<ApiResponse<SourceDetails>>('/api/v1/sources', {
      method: 'POST',
      body: { ...input, targets: [{ targetType: 'persona', targetId: personaId }] },
    })
    await Promise.all([refresh(), refreshSources(), refreshGrowth()])
  })
}

/**
 * 逐个上传文件资料并在创建时关联当前人物。
 * @param input 共用用途和带独立名称的文件列表。
 * @returns 全部文件处理和详情刷新完成时结束。
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
      body.set('targets', JSON.stringify([{ targetType: 'persona', targetId: personaId }]))
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
      notifySuccess(`${succeeded} 个新资料已创建并加入这个人物`, '资料导入完成')
    }
  }
  finally {
    actionLoading.value = false
  }
}

/**
 * 查询永久删除人物的影响范围。
 * @returns 查询完成时结束。
 */
async function inspectDeletion(): Promise<void> {
  await runAction(null, async () => {
    const response = await $fetch<ApiResponse<DeletionImpact>>(`/api/v1/personas/${personaId}/deletion-impact`)
    deletionImpact.value = response.data
  })
}

/**
 * 在用户明确确认后永久删除人物。
 * @returns 删除和导航完成时结束。
 */
async function deletePersona(): Promise<void> {
  if (!deletionImpact.value?.canDelete) return
  await runAction('人物已永久删除', async () => {
    await $fetch(`/api/v1/personas/${personaId}`, { method: 'DELETE' })
    await navigateTo('/personas')
  })
}

/**
 * 写入人物启用状态，不删除人物设定、资料、记忆或历史记录。
 * @param isEnabled 需要写入的新状态。
 * @returns 状态请求和详情刷新完成时结束。
 */
async function updatePersonaStatus(isEnabled: boolean): Promise<void> {
  await runAction(isEnabled ? '人物已启用' : '人物已禁用', async () => {
    await $fetch(`/api/v1/personas/${personaId}/status`, { method: 'PATCH', body: { isEnabled } })
    await refresh()
  })
}

/**
 * 根据人物当前状态打开启用或禁用二次确认框。
 * @returns 确认框打开时结束。
 */
async function requestPersonaStatusChange(): Promise<void> {
  if (!details.value) return
  if (details.value.persona.isEnabled) {
    disableConfirmationOpen.value = true
    return
  }
  enableConfirmationOpen.value = true
}

/** @returns 用户确认后的启用请求完成时结束。 */
async function confirmEnablePersona(): Promise<void> {
  enableConfirmationOpen.value = false
  await updatePersonaStatus(true)
}

/** @returns 用户确认后的禁用请求完成时结束。 */
async function confirmDisablePersona(): Promise<void> {
  disableConfirmationOpen.value = false
  await updatePersonaStatus(false)
}

/**
 * 重新加载人物详情与灵魂工作区。
 * @returns 两项读取请求全部结束时完成。
 */
async function retryPersonaWorkspace(): Promise<void> {
  await Promise.all([refresh(), refreshSoul()])
}

/**
 * 统一管理页面动作状态和通俗反馈。
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
    <ContentPageHeader
      :title="details?.persona.name || '人物工作区'"
      :description="details?.persona.currentSummary || '管理人物灵魂、成长、记忆和资料。'"
    >
      <template v-if="details" #leading>
        <ContentPersonaAvatar :name="details.persona.name" :url="headerAvatarUrl" size="header" />
      </template>
      <UButton to="/personas" color="neutral" variant="ghost">返回人物列表</UButton>
      <UButton v-if="details?.persona.isEnabled" to="/workbench">新建任务</UButton>
    </ContentPageHeader>

    <UAlert v-if="error || !details || !soul" color="error" title="人物工作区加载失败" :actions="[{ label: '重试', onClick: retryPersonaWorkspace }]" />
    <template v-else>
      <UAlert v-if="!details.persona.isEnabled" class="mb-6" color="warning" title="人物当前已禁用" description="人物设定、成长、记忆、资料关系和历史任务仍会保留，但不能用来创建新任务。" />

      <div class="status-strip page-status-strip mb-6">
        <div class="status-cell"><span class="status-kicker">所属世界</span><strong class="status-value">{{ details.persona.worldName || '未关联世界' }}</strong></div>
        <div class="status-cell"><span class="status-kicker">当前灵魂</span><strong class="status-value">已保存并使用</strong></div>
        <div class="status-cell"><span class="status-kicker">参考资料</span><strong class="status-value">{{ details.sources.length }} 项</strong></div>
        <div class="status-cell"><span class="status-kicker">提示词历史</span><strong class="status-value">{{ soul.versions.length }} 个版本</strong></div>
      </div>

      <nav class="mind-tabs mb-6" aria-label="人物工作区标签">
        <button v-for="tab in tabs" :key="tab.id" class="mind-tab" :aria-selected="selectedTab === tab.id" @click="selectTab(tab.id)">{{ tab.label }}</button>
      </nav>

      <div v-if="selectedTab === 'basic'" class="space-y-6">
        <UCard>
          <template #header><div><h2 class="font-semibold text-highlighted">基本信息</h2><p class="mt-1 text-sm text-muted">名称用于后台辨认；所属世界当前使用的灵魂会进入人物的新任务。</p></div></template>
          <UForm :schema="updatePersonaSchema" :state="metadata" class="grid gap-4 md:grid-cols-2" @submit="saveMetadata">
            <UFormField name="name" label="人物名称" required><UInput v-model="metadata.name" class="w-full" /></UFormField>
            <UFormField name="worldId" label="所属世界">
              <select v-model="metadata.worldId" class="native-control"><option :value="null">不关联世界</option><option v-for="world in worlds" :key="world.id" :value="world.id">{{ world.name }}{{ world.isEnabled ? '' : '（已禁用）' }}</option></select>
            </UFormField>
            <div class="md:col-span-2"><UButton type="submit" :loading="actionLoading">保存基本信息</UButton></div>
          </UForm>
        </UCard>

        <div class="grid gap-6 xl:grid-cols-2">
          <ContentPersonaCredentialPanel
            :credential="details.credentials"
            :revealed="revealedCredential"
            :loading="actionLoading"
            @reveal="revealCredential"
            @conceal="concealCredential"
            @save="saveCredential"
          />
          <ContentPersonaAvatarEditor
            :persona-id="details.persona.id"
            :persona-name="details.persona.name"
            :avatar-url="details.persona.avatarUrl"
            :avatar-original-url="details.persona.avatarOriginalUrl"
            @updated="refreshPersonaAvatar"
          />
        </div>
      </div>

      <div v-else-if="selectedTab === 'prompts'">
        <ContentWorkspaceModuleNav v-model="selectedPromptModule" :items="promptModules" ariaLabel="人物提示词模块" />
        <ContentSoulWorkspace
          v-if="selectedPromptModule === 'soul'"
          :workspace="soul"
          :loading="actionLoading"
          @save="saveSoulVersion"
        />
        <LearningPromptPanel
          v-else-if="selectedPromptModule === 'growth'"
          title="人物成长"
          :workspace="growthWorkspace.prompt"
          :input-statistics="growthWorkspace.inputStatistics"
          :batch="growthAnalysis"
          :loading="actionLoading"
          @analyze="analyzeLearning('growth', $event)"
          @refresh="refreshLearningAnalysis('growth')"
          @save-and-publish="saveAndPublishLearningPrompt('growth', $event)"
        />
        <LearningPromptPanel
          v-else
          title="人物记忆"
          :workspace="memoryWorkspace.prompt"
          :input-statistics="memoryWorkspace.inputStatistics"
          :batch="memoryAnalysis"
          :loading="actionLoading"
          @analyze="analyzeLearning('memory', $event)"
          @refresh="refreshLearningAnalysis('memory')"
          @save-and-publish="saveAndPublishLearningPrompt('memory', $event)"
        />
      </div>

      <div v-else-if="selectedTab === 'materials'">
        <ContentWorkspaceModuleNav v-model="selectedMaterialModule" :items="materialModules" ariaLabel="人物资料模块" />
        <ContentSubjectSourceManager
          v-if="selectedMaterialModule === 'sources'"
          subject-type="persona"
          :subject-name="details.persona.name"
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
          subject-label="人物"
          :items="growthWorkspace.materials"
          :sources="growthWorkspace.sources"
          :loading="actionLoading"
          @import-sources="importGrowthSources"
          @create="createGrowthMaterial"
          @update="updateGrowthMaterial"
          @status="updateGrowthMaterialStatus"
          @delete="deleteGrowthMaterials"
        />
        <LearningOperationRecordPanel
          v-else-if="selectedMaterialModule === 'records'"
          :items="memoryWorkspace.operationRecords"
          :loading="actionLoading"
          @status="updateOperationRecordStatus"
          @importance="updateOperationRecordImportance"
        />
        <LearningExternalRecordPanel
          v-else
          :items="memoryWorkspace.externalRecords"
          :loading="actionLoading"
          @create="createExternalRecord"
          @update="updateExternalRecord"
          @status="updateExternalRecordStatus"
          @delete="deleteExternalRecords"
        />
      </div>

      <ContentLifecycleOperationsPanel
        v-else
        subject-type="persona"
        :subject-name="details.persona.name"
        :is-enabled="details.persona.isEnabled"
        :deletion-impact="deletionImpact"
        :loading="actionLoading"
        @request-status-change="requestPersonaStatusChange"
        @inspect-deletion="inspectDeletion"
        @delete="deletePersona"
      />
    </template>

    <UModal v-model:open="enableConfirmationOpen" title="确认启用人物" description="启用后，可以重新用该人物创建新任务。">
      <template #body><p class="text-sm text-muted">确定启用“{{ details?.persona.name }}”吗？</p></template>
      <template #footer><div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :disabled="actionLoading" @click="enableConfirmationOpen = false">取消</UButton>
        <UButton color="success" :loading="actionLoading" @click="confirmEnablePersona">确认启用</UButton>
      </div></template>
    </UModal>

    <UModal v-model:open="disableConfirmationOpen" title="确认禁用人物" description="禁用不会删除人物设定、成长、记忆、资料关系或历史任务。">
      <template #body><p class="text-sm text-muted">确定禁用“{{ details?.persona.name }}”吗？禁用后不能再用该人物创建新任务。</p></template>
      <template #footer><div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :disabled="actionLoading" @click="disableConfirmationOpen = false">取消</UButton>
        <UButton color="error" :loading="actionLoading" @click="confirmDisablePersona">确认禁用</UButton>
      </div></template>
    </UModal>
  </div>
</template>
