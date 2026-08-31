<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { PublishAiAlgorithmConfigurationInput } from '#shared/schemas/aiConfiguration'
import type { ApiResponse } from '#shared/types/api'
import type { AiAlgorithmCode, AiAlgorithmView, AiModelDeploymentView } from '#shared/types/aiConfiguration'
import type { AiPromptWorkspaceView } from '#shared/types/aiPrompt'
import { getApiErrorMessage } from '../utils/apiError'

/** AI 算法页的顶层分类。 */
type AiAlgorithmCategory = 'soul' | 'growth' | 'memory'

/** 等待确认的算法与提示词选择。 */
interface PendingAlgorithmSelection {
  /** 目标算法编码。 */
  algorithmCode: AiAlgorithmCode
  /** 目标步骤提示词编码。 */
  promptCode: string
}

const categories: Array<{ code: AiAlgorithmCategory, label: string, description: string }> = [
  { code: 'soul', label: '灵魂整理', description: '整理管理员手工设定的人物或世界初始灵魂。' },
  { code: 'growth', label: '成长提炼', description: '先提取带证据结论，再综合为待审核的成长提示词。' },
  { code: 'memory', label: '记忆提炼', description: '按来源与独立证据门槛提炼人物长期记忆。' },
]

const route = useRoute()
const [algorithmRequest, deploymentRequest, promptRequest] = await Promise.all([
  useFetch<ApiResponse<AiAlgorithmView[]>>('/api/v1/ai/algorithms'),
  useFetch<ApiResponse<AiModelDeploymentView[]>>('/api/v1/ai/model-deployments'),
  useFetch<ApiResponse<AiPromptWorkspaceView[]>>('/api/v1/ai-prompts'),
])
const algorithms = computed(() => algorithmRequest.data.value?.data ?? [])
const deployments = computed(() => deploymentRequest.data.value?.data ?? [])
const prompts = computed(() => promptRequest.data.value?.data ?? [])
const { notifySuccess, notifyError } = useOperationNotifications()
const requestedAlgorithmCode = typeof route.query.algorithm === 'string' ? route.query.algorithm : ''
const requestedPromptCode = typeof route.query.prompt === 'string' ? route.query.prompt : ''
const initialAlgorithm = findInitialAlgorithm()
const selectedAlgorithmCode = shallowRef<AiAlgorithmCode>(initialAlgorithm?.code ?? 'persona_soul')
const selectedPromptCode = shallowRef(initialAlgorithm?.stepDefinitions.some(step => step.promptCode === requestedPromptCode)
  ? requestedPromptCode
  : initialAlgorithm?.stepDefinitions[0]?.promptCode ?? '')
const pendingSelection = shallowRef<PendingAlgorithmSelection | null>(null)
const switchConfirmationOpen = shallowRef(false)
const promptDirty = shallowRef(false)
const savingCode = shallowRef<AiAlgorithmCode | null>(null)
const selectedAlgorithm = computed(() => algorithms.value.find(algorithm => algorithm.code === selectedAlgorithmCode.value) ?? algorithms.value[0] ?? null)
const activeCategory = computed<AiAlgorithmCategory>(() => algorithmCategory(selectedAlgorithm.value?.code ?? 'persona_soul'))
const categoryAlgorithms = computed(() => algorithms.value.filter(algorithm => algorithmCategory(algorithm.code) === activeCategory.value))
const selectedPrompt = computed(() => prompts.value.find(prompt => prompt.code === selectedPromptCode.value) ?? null)
const configuredCount = computed(() => algorithms.value.filter(item => item.activeConfigurationVersion !== null).length)
const enabledTextDeploymentCount = computed(() => deployments.value.filter(item => item.modality === 'text' && item.isEnabled).length)

/**
 * 根据地址栏的算法或提示词编码确定首次展示的算法。
 * @returns 匹配的算法；没有匹配时使用第一个算法。
 */
function findInitialAlgorithm(): AiAlgorithmView | null {
  return algorithms.value.find(algorithm => algorithm.code === requestedAlgorithmCode)
    ?? algorithms.value.find(algorithm => algorithm.stepDefinitions.some(step => step.promptCode === requestedPromptCode))
    ?? algorithms.value[0]
    ?? null
}

/**
 * 把固定算法编码归入灵魂整理、成长提炼或记忆提炼。
 * @param code 固定算法编码。
 * @returns 算法所属顶层分类。
 */
function algorithmCategory(code: AiAlgorithmCode): AiAlgorithmCategory {
  if (code === 'persona_memory') return 'memory'
  return code.endsWith('_growth') ? 'growth' : 'soul'
}

/**
 * 请求切换顶层算法分类，默认选中该分类的第一个算法。
 * @param category 目标算法分类。
 * @returns 无返回值。
 */
function requestCategory(category: AiAlgorithmCategory): void {
  const target = algorithms.value.find(algorithm => algorithmCategory(algorithm.code) === category)
  if (target) requestAlgorithm(target)
}

/**
 * 请求切换人物或世界算法，并默认选中其第一个步骤提示词。
 * @param algorithm 目标固定算法。
 * @returns 无返回值。
 */
function requestAlgorithm(algorithm: AiAlgorithmView): void {
  const promptCode = algorithm.stepDefinitions[0]?.promptCode ?? ''
  requestSelection({ algorithmCode: algorithm.code, promptCode })
}

/**
 * 请求编辑当前算法中指定步骤的提示词。
 * @param promptCode 目标提示词编码。
 * @returns 无返回值。
 */
function requestPrompt(promptCode: string): void {
  if (!selectedAlgorithm.value) return
  requestSelection({ algorithmCode: selectedAlgorithm.value.code, promptCode })
}

/**
 * 统一处理算法或步骤切换；提示词存在未保存修改时先要求确认。
 * @param selection 目标算法与步骤提示词。
 * @returns 无返回值。
 */
function requestSelection(selection: PendingAlgorithmSelection): void {
  if (selection.algorithmCode === selectedAlgorithmCode.value && selection.promptCode === selectedPromptCode.value) return
  if (promptDirty.value) {
    pendingSelection.value = selection
    switchConfirmationOpen.value = true
    return
  }
  applySelection(selection)
}

/**
 * 应用已确认的算法与步骤提示词选择。
 * @param selection 目标算法与步骤提示词。
 * @returns 无返回值。
 */
function applySelection(selection: PendingAlgorithmSelection): void {
  selectedAlgorithmCode.value = selection.algorithmCode
  selectedPromptCode.value = selection.promptCode
  pendingSelection.value = null
  switchConfirmationOpen.value = false
  promptDirty.value = false
}

/**
 * 丢弃当前未保存的提示词修改，完成等待中的切换。
 * @returns 无返回值。
 */
function confirmSelection(): void {
  if (pendingSelection.value) applySelection(pendingSelection.value)
}

/**
 * 发布指定算法的一版完整配置并刷新算法列表。
 * @param code 固定算法编码。
 * @param input 全部固定步骤的模型与参数。
 * @returns 发布与刷新完成时结束。
 */
async function saveAlgorithm(code: AiAlgorithmCode, input: PublishAiAlgorithmConfigurationInput): Promise<void> {
  savingCode.value = code
  try {
    await $fetch(`/api/v1/ai/algorithms/${code}`, { method: 'PUT', body: input })
    await algorithmRequest.refresh()
    notifySuccess('算法配置新版本已发布，之后创建的任务将使用新快照。', '发布完成')
  }
  catch (error: unknown) {
    notifyError(getApiErrorMessage(error, '算法配置发布失败'), '发布失败')
  }
  finally {
    savingCode.value = null
  }
}
</script>

<template>
  <div>
    <ContentPageHeader title="AI 算法" description="按灵魂整理、成长提炼与记忆提炼分类维护固定流程；模型、参数和步骤提示词在同一处调整。" />
    <div class="status-strip page-status-strip" aria-label="AI 算法状态摘要">
      <div class="status-cell"><span class="status-kicker">固定算法</span><strong class="status-value">{{ algorithms.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">已配置</span><strong class="status-value">{{ configuredCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">可用文本模型</span><strong class="status-value">{{ enabledTextDeploymentCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">配置策略</span><strong class="status-value">版本化发布</strong></div>
    </div>

    <nav class="algorithm-category-tabs" aria-label="AI 算法分类">
      <button
        v-for="category in categories"
        :key="category.code"
        type="button"
        class="algorithm-category-tab"
        :class="{ 'algorithm-category-tab--active': category.code === activeCategory }"
        :aria-current="category.code === activeCategory ? 'page' : undefined"
        @click="requestCategory(category.code)"
      >
        <strong>{{ category.label }}</strong>
        <span>{{ category.description }}</span>
      </button>
    </nav>

    <div class="space-y-5 py-9">
      <UAlert color="neutral" variant="subtle" title="算法边界" description="步骤、顺序、变量组装和输出结构固定在代码中；这里只维护每个步骤的模型、调用参数和提示词版本。" />
      <UAlert v-if="algorithmRequest.error.value || deploymentRequest.error.value || promptRequest.error.value" color="error" title="算法配置加载失败" />

      <div v-if="selectedAlgorithm" class="space-y-6">
        <div class="algorithm-subject-tabs" aria-label="人物与世界算法">
          <button
            v-for="algorithm in categoryAlgorithms"
            :key="algorithm.code"
            type="button"
            class="algorithm-subject-tab"
            :class="{ 'algorithm-subject-tab--active': algorithm.code === selectedAlgorithm.code }"
            @click="requestAlgorithm(algorithm)"
          >
            <span>{{ algorithm.code.startsWith('persona_') ? '人物' : '世界' }}</span>
            <strong>{{ algorithm.name }}</strong>
            <UBadge :color="algorithm.activeConfigurationVersion ? 'success' : 'warning'" variant="subtle">{{ algorithm.activeConfigurationVersion ? `配置 v${algorithm.activeConfigurationVersion}` : '待配置' }}</UBadge>
          </button>
        </div>

        <AiConfigurationAiAlgorithmConfigurationCard
          :key="`${selectedAlgorithm.code}-${selectedAlgorithm.activeConfigurationVersion ?? 0}`"
          :algorithm="selectedAlgorithm"
          :deployments="deployments"
          :loading="savingCode === selectedAlgorithm.code"
          @save="saveAlgorithm(selectedAlgorithm.code, $event)"
          @edit-prompt="requestPrompt"
        />

        <AiConfigurationAiAlgorithmTestPanel :key="selectedAlgorithm.code" :algorithm="selectedAlgorithm" />

        <section class="content-section" aria-labelledby="algorithm-prompt-heading">
          <div class="section-heading">
            <div class="section-heading-copy"><p class="eyebrow">步骤提示词</p><h2 id="algorithm-prompt-heading">同页校准提示词</h2><p>点击上方任一步骤的“编辑该步骤提示词”，即可在不离开算法上下文的情况下维护版本。</p></div>
          </div>
          <AiPromptEditor
            v-if="selectedPrompt"
            :key="selectedPrompt.code"
            :prompt="selectedPrompt"
            @changed="promptRequest.refresh()"
            @dirty-change="promptDirty = $event"
          />
          <UAlert v-else color="error" title="步骤提示词不存在" :description="`未找到固定提示词：${selectedPromptCode || '未绑定'}`" />
        </section>
      </div>
      <div v-else class="content-empty-state"><div><strong>算法定义不可用</strong><p>请检查数据库迁移是否完成。</p></div></div>
    </div>

    <UModal v-model:open="switchConfirmationOpen" title="放弃未保存的提示词修改？" description="切换算法或步骤会重置当前提示词编辑器，未保存内容无法找回。">
      <template #footer><UButton variant="ghost" @click="switchConfirmationOpen = false">继续编辑</UButton><UButton color="warning" @click="confirmSelection">放弃并切换</UButton></template>
    </UModal>
  </div>
</template>

<style scoped>
.algorithm-category-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 2rem;
  overflow: hidden;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-control);
  background: var(--app-surface-raised);
}

.algorithm-category-tab {
  display: grid;
  gap: 0.35rem;
  padding: 1.25rem;
  border: 0;
  border-left: 1px solid var(--app-border);
  background: transparent;
  color: var(--app-muted);
  text-align: left;
  cursor: pointer;
}

.algorithm-category-tab:first-child {
  border-left: 0;
}

.algorithm-category-tab strong {
  color: var(--app-fg);
}

.algorithm-category-tab span {
  font-size: 0.8125rem;
}

.algorithm-category-tab:hover,
.algorithm-category-tab--active {
  background: var(--app-surface-soft);
}

.algorithm-category-tab--active {
  box-shadow: inset 0 -3px 0 var(--app-accent);
}

.algorithm-subject-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.algorithm-subject-tab {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-control);
  background: var(--app-surface-raised);
  color: var(--app-muted);
  text-align: left;
  cursor: pointer;
}

.algorithm-subject-tab > span:first-child {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.algorithm-subject-tab strong {
  color: var(--app-fg);
}

.algorithm-subject-tab:hover,
.algorithm-subject-tab--active {
  border-color: var(--app-border-strong);
  background: var(--app-surface-soft);
}

.algorithm-subject-tab--active {
  box-shadow: inset 3px 0 0 var(--app-accent);
}

@media (max-width: 40rem) {
  .algorithm-category-tabs,
  .algorithm-subject-tabs {
    grid-template-columns: 1fr;
  }

  .algorithm-category-tab,
  .algorithm-category-tab:first-child {
    border-top: 1px solid var(--app-border);
    border-left: 0;
  }

  .algorithm-category-tab:first-child {
    border-top: 0;
  }

  .algorithm-subject-tab {
    grid-template-columns: auto minmax(0, 1fr);
  }
}
</style>
