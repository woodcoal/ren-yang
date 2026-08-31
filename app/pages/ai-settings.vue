<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import { systemAiSettingsValuesSchema, type SystemAiSettingsValues } from '#shared/schemas/systemAi'
import type { ApiResponse } from '#shared/types/api'
import type { AiAlgorithmView, AiModelDeploymentView } from '#shared/types/aiConfiguration'
import type { AiPromptWorkspaceView } from '#shared/types/aiPrompt'
import type { SystemAiOperation, SystemAiSettingsView } from '#shared/types/systemAi'
import { getApiErrorMessage } from '../utils/apiError'

/** AI 设置页一个业务分类的展示契约。 */
interface AiSettingsSection {
  /** 选项卡稳定编码。 */
  code: 'interest' | 'memory' | 'draft' | 'feedback' | 'creation'
  /** 页面显示名称。 */
  label: string
  /** 分类用途说明。 */
  description: string
  /** 对应的系统 AI 参数组；纯提示词分类为空。 */
  operation: SystemAiOperation | null
}

const sections: AiSettingsSection[] = [
  { code: 'interest', label: '兴趣判断', description: '判断人物对指定内容的兴趣与信心。', operation: 'interestAnalysis' },
  { code: 'memory', label: '人物记忆', description: '从第三方记录和历史操作中提炼长期记忆。', operation: 'contentAnalysis' },
  { code: 'draft', label: '草稿生成', description: '根据自然语言快速建立人物或世界草稿。', operation: 'draftGeneration' },
  { code: 'feedback', label: '反馈分类', description: '判断反馈应归属于产物、参数、资料或成长。', operation: 'feedbackClassification' },
  { code: 'creation', label: '内容与视觉', description: '管理文档规划、图文生成及其他非算法提示词。', operation: null },
]

const route = useRoute()
const [settingsRequest, promptRequest, algorithmRequest, deploymentRequest] = await Promise.all([
  useFetch<ApiResponse<SystemAiSettingsView>>('/api/v1/system/ai-settings'),
  useFetch<ApiResponse<AiPromptWorkspaceView[]>>('/api/v1/ai-prompts'),
  useFetch<ApiResponse<AiAlgorithmView[]>>('/api/v1/ai/algorithms'),
  useFetch<ApiResponse<AiModelDeploymentView[]>>('/api/v1/ai/model-deployments'),
])
const values = reactive<SystemAiSettingsValues>(systemAiSettingsValuesSchema.parse(settingsRequest.data.value?.data.values ?? {
  textModelDeploymentId: '',
  imageModelDeploymentId: '',
  interestAnalysis: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000, maxEvidenceChunks: 8 },
  contentAnalysis: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 },
  draftGeneration: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000 },
  feedbackClassification: { temperature: 0, maxOutputTokens: 4_096, timeoutMs: 60_000 },
}))
const prompts = computed(() => promptRequest.data.value?.data ?? [])
const algorithms = computed(() => algorithmRequest.data.value?.data ?? [])
const deployments = computed(() => deploymentRequest.data.value?.data ?? [])
const { notifySuccess, notifyError } = useOperationNotifications()
const algorithmPromptCodes = computed(() => new Set(algorithms.value.flatMap(algorithm => algorithm.stepDefinitions.map(step => step.promptCode))))
const requestedPromptCode = typeof route.query.code === 'string' ? route.query.code : ''
const activeSectionCode = shallowRef<AiSettingsSection['code']>(findSettingsSectionCode(requestedPromptCode))
const pendingSectionCode = shallowRef<AiSettingsSection['code'] | null>(null)
const switchConfirmationOpen = shallowRef(false)
const promptDirty = shallowRef(false)
const loading = shallowRef(false)
const activeSection = computed(() => sections.find(section => section.code === activeSectionCode.value) ?? sections[0]!)
const currentPrompts = computed(() => prompts.value.filter(prompt => !algorithmPromptCodes.value.has(prompt.code)
  && settingsSectionForPrompt(prompt.code) === activeSectionCode.value))
const nonAlgorithmPrompts = computed(() => prompts.value.filter(prompt => !algorithmPromptCodes.value.has(prompt.code)))
const draftCount = computed(() => nonAlgorithmPrompts.value.filter(prompt => prompt.draft !== null).length)
const updatedAt = computed(() => settingsRequest.data.value?.data.updatedAt ?? null)
const requestsPending = computed(() => settingsRequest.status.value === 'pending' || promptRequest.status.value === 'pending'
  || algorithmRequest.status.value === 'pending' || deploymentRequest.status.value === 'pending')
const requestFailed = computed(() => Boolean(settingsRequest.error.value || promptRequest.error.value
  || algorithmRequest.error.value || deploymentRequest.error.value))

/**
 * 根据提示词编码确定它在 AI 设置页的业务分类。
 * @param code 提示词稳定编码。
 * @returns 对应选项卡编码；未单独列出的提示词统一归入内容与视觉。
 */
function settingsSectionForPrompt(code: string): AiSettingsSection['code'] {
  if (code === 'generation.interest_assessment') return 'interest'
  if (code === 'analysis.persona_memory') return 'memory'
  if (code === 'generation.persona_draft' || code === 'generation.world_draft') return 'draft'
  if (code === 'feedback.classification') return 'feedback'
  return 'creation'
}

/**
 * 根据兼容路由传入的提示词选择首次展示的业务分类。
 * @param code 地址栏中的提示词编码。
 * @returns 首次展示的选项卡编码。
 */
function findSettingsSectionCode(code: string): AiSettingsSection['code'] {
  return code ? settingsSectionForPrompt(code) : 'interest'
}

/**
 * 请求切换 AI 设置分类；提示词存在未保存修改时先要求确认。
 * @param code 目标分类编码。
 * @returns 无返回值。
 */
function requestSection(code: AiSettingsSection['code']): void {
  if (code === activeSectionCode.value) return
  if (promptDirty.value) {
    pendingSectionCode.value = code
    switchConfirmationOpen.value = true
    return
  }
  applySection(code)
}

/**
 * 应用已确认的 AI 设置分类选择。
 * @param code 目标分类编码。
 * @returns 无返回值。
 */
function applySection(code: AiSettingsSection['code']): void {
  activeSectionCode.value = code
  pendingSectionCode.value = null
  switchConfirmationOpen.value = false
  promptDirty.value = false
}

/**
 * 丢弃当前提示词的未保存修改并切换业务分类。
 * @returns 无返回值。
 */
function confirmSectionSwitch(): void {
  if (pendingSectionCode.value) applySection(pendingSectionCode.value)
}

/**
 * 保存四类完整系统 AI 参数，避免局部更新产生隐式继承。
 * @param submittedValues 已通过共享 Schema 校验的完整设置。
 * @returns 保存与本地状态同步完成时结束。
 */
async function saveSettings(submittedValues: SystemAiSettingsValues): Promise<void> {
  loading.value = true
  try {
    const response = await $fetch<ApiResponse<SystemAiSettingsView>>('/api/v1/system/ai-settings', {
      method: 'PUT',
      body: submittedValues,
    })
    Object.assign(values, systemAiSettingsValuesSchema.parse(response.data.values))
    settingsRequest.data.value = response
    notifySuccess('后续新操作将使用当前参数。', 'AI 参数已保存')
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, 'AI 参数保存失败'), '保存失败')
  }
  finally {
    loading.value = false
  }
}

/**
 * 同时刷新系统参数、提示词与算法定义。
 * @returns 三类请求全部结束时完成。
 */
async function refreshAll(): Promise<void> {
  await Promise.all([settingsRequest.refresh(), promptRequest.refresh(), algorithmRequest.refresh(), deploymentRequest.refresh()])
}

/**
 * 把 UTC Unix 毫秒转换为当前设备的中文日期时间。
 * @param timestamp UTC Unix 毫秒时间戳。
 * @returns 本地化后的中文日期时间。
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <ContentPageHeader title="AI 设置" description="按业务场景集中管理剩余 AI 参数和非算法提示词；灵魂与成长提示词在 AI 算法中维护。" />

    <div class="status-strip page-status-strip" aria-label="AI 设置状态摘要">
      <div class="status-cell"><span class="status-kicker">业务分类</span><strong class="status-value">{{ sections.length }} 类</strong></div>
      <div class="status-cell"><span class="status-kicker">非算法提示词</span><strong class="status-value">{{ nonAlgorithmPrompts.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">待发布草稿</span><strong class="status-value">{{ draftCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">最近参数保存</span><strong class="status-value">{{ updatedAt ? formatTime(updatedAt) : '系统默认' }}</strong></div>
    </div>

    <nav class="management-tabs" aria-label="AI 设置分类">
      <button
        v-for="section in sections"
        :key="section.code"
        type="button"
        class="management-tab"
        :class="{ 'management-tab--active': section.code === activeSectionCode }"
        :aria-current="section.code === activeSectionCode ? 'page' : undefined"
        @click="requestSection(section.code)"
      >
        <strong>{{ section.label }}</strong>
        <span>{{ section.description }}</span>
      </button>
    </nav>

    <div class="space-y-5 py-9">
      <UAlert v-if="requestFailed" color="error" title="AI 设置加载失败" description="参数、提示词或算法定义不完整，已停止编辑。" :actions="[{ label: '重试', onClick: refreshAll }]" />
      <div v-if="requestsPending" class="content-empty-state"><div><strong>正在读取 AI 设置</strong><p>加载参数、提示词与算法归属。</p></div></div>
      <template v-else-if="!requestFailed">
        <div class="section-heading">
          <div class="section-heading-copy"><p class="eyebrow">当前分类</p><h2>{{ activeSection.label }}</h2><p>{{ activeSection.description }}</p></div>
        </div>
        <SystemAiSettingsForm
          :model-value="values"
          :operation="activeSection.operation"
          :deployments="deployments"
          :loading="loading"
          @submit="saveSettings"
        />
        <section class="content-section" aria-labelledby="settings-prompts-heading">
          <div class="section-heading">
            <div class="section-heading-copy"><p class="eyebrow">提示词设置</p><h2 id="settings-prompts-heading">{{ activeSection.label }}提示词</h2><p>编辑先保存为草稿，只有发布新版本后才会影响新 AI 操作。</p></div>
          </div>
          <AiPromptWorkspace
            :key="activeSection.code"
            :prompts="currentPrompts"
            :initial-code="requestedPromptCode"
            @refresh="promptRequest.refresh()"
            @dirty-change="promptDirty = $event"
          />
        </section>
      </template>
    </div>

    <UModal v-model:open="switchConfirmationOpen" title="放弃未保存的提示词修改？" description="切换业务分类会重置当前提示词编辑器，未保存内容无法找回。">
      <template #footer><UButton variant="ghost" @click="switchConfirmationOpen = false">继续编辑</UButton><UButton color="warning" @click="confirmSectionSwitch">放弃并切换</UButton></template>
    </UModal>
  </div>
</template>

<style scoped>
.management-tabs {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin-top: 2rem;
  overflow: hidden;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-control);
  background: var(--app-surface-raised);
}

.management-tab {
  display: grid;
  min-width: 0;
  gap: 0.35rem;
  padding: 1rem;
  border: 0;
  border-left: 1px solid var(--app-border);
  background: transparent;
  color: var(--app-muted);
  text-align: left;
  cursor: pointer;
}

.management-tab:first-child {
  border-left: 0;
}

.management-tab strong {
  color: var(--app-fg);
  font-size: 0.875rem;
}

.management-tab span {
  font-size: 0.75rem;
  line-height: 1.45;
}

.management-tab:hover,
.management-tab--active {
  background: var(--app-surface-soft);
}

.management-tab--active {
  box-shadow: inset 0 -3px 0 var(--app-accent);
}

@media (max-width: 70rem) {
  .management-tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .management-tab:nth-child(odd) {
    border-left: 0;
  }

  .management-tab:nth-child(n+3) {
    border-top: 1px solid var(--app-border);
  }
}

@media (max-width: 40rem) {
  .management-tabs {
    display: flex;
    overflow-x: auto;
  }

  .management-tab,
  .management-tab:nth-child(odd),
  .management-tab:nth-child(n+3) {
    min-width: 12rem;
    flex: 0 0 12rem;
    border-top: 0;
    border-left: 1px solid var(--app-border);
  }

  .management-tab:first-child {
    border-left: 0;
  }
}
</style>
