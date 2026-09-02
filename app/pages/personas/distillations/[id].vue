<script setup lang="ts">
import { computed } from 'vue'
import type {
  ConfirmPersonaDistillationCandidateInput,
  ReviewPersonaDistillationSourcesInput,
  SavePersonaDistillationCandidateInput,
} from '#shared/schemas/personaDistillation'
import type { PersonaDistillationStatus } from '#shared/types/personaDistillation'

const route = useRoute()
const runId = String(route.params.id)
const {
  run,
  error,
  active,
  actionLoading,
  refresh,
  reviewSources,
  saveCandidate,
  confirmCandidate,
  cancelRun,
  retryRun,
} = await usePersonaDistillation(runId)

/** 人物蒸馏工作区对外展示的四个阶段。 */
const workflowSteps = computed(() => [
  { label: '资料检查', description: '识别来源与覆盖' },
  { label: '范围确认', description: '人工选择资料' },
  { label: '提炼评测', description: '生成并验证候选' },
  { label: '最终确认', description: run.value?.mode === 'update' ? '发布新灵魂' : '创建人物与灵魂' },
])

const currentStep = computed(() => {
  if (!run.value) return 0
  if (run.value.status === 'awaiting_source_review') return 1
  if (['extracting', 'synthesizing', 'evaluating'].includes(run.value.status)) return 2
  if (['awaiting_candidate_review', 'completed'].includes(run.value.status)) return 3
  return run.value.status === 'failed' || run.value.status === 'canceled' ? 2 : 0
})
const cancelable = computed(() => run.value
  ? !['completed', 'failed', 'canceled'].includes(run.value.status)
  : false)

/**
 * 将运行状态转换为工作区主标题。
 * @param status 当前人物蒸馏状态。
 * @param mode 创建新人物或更新已有人物。
 * @returns 用户可理解的状态标题。
 */
function statusTitle(status: PersonaDistillationStatus, mode: 'create' | 'update'): string {
  return ({
    assessing_sources: '正在检查资料覆盖',
    awaiting_source_review: '等待你确认资料范围',
    extracting: '正在提取人物认知',
    synthesizing: '正在综合人物候选',
    evaluating: '正在评测人物候选',
    awaiting_candidate_review: '等待你校准并确认候选',
    completed: mode === 'update' ? '人物灵魂已更新' : '人物已经创建',
    failed: '人物蒸馏未完成',
    canceled: '人物蒸馏已取消',
  })[status]
}

/**
 * 将活动运行状态转换为下一步说明。
 * @param status 当前人物蒸馏状态。
 * @param mode 创建新人物或更新已有人物。
 * @returns 用户可理解的持久任务说明。
 */
function statusDescription(status: PersonaDistillationStatus, mode: 'create' | 'update'): string {
  return ({
    assessing_sources: '系统正在识别资料关系、覆盖维度和同源内容。完成后需要你确认资料范围。',
    awaiting_source_review: '检查模型建议的资料分类，确认哪些资料进入认知提取。',
    extracting: '系统正在从确认资料中提取带精确引文的认知候选。',
    synthesizing: '系统正在把通过程序校验的认知候选编译为完整单文本灵魂。',
    evaluating: '系统正在检查已知事实、未知边界、表达方式、反事实和冲突处理。',
    awaiting_candidate_review: '检查候选正文、证据和六类评测；任何正文修改都需要重新评测。',
    completed: mode === 'update'
      ? '新灵魂版本已原子发布到原人物，旧版本仍保留在提示词历史中。'
      : '人物及初始当前灵魂版本已原子写入，可以进入人物工作区继续维护。',
    failed: '固定输入和错误已经保留。可以基于相同快照创建一次新运行。',
    canceled: mode === 'update'
      ? '运行已停在安全点，原人物和当前灵魂保持不变；如需继续，请返回人物详情重新发起。'
      : '运行停在安全点且没有创建人物；如需继续，请从人物列表重新创建。',
  })[status]
}

/**
 * 确认资料范围并进入自动提炼阶段。
 * @param input 页面提交的资料范围和分类纠正。
 * @returns 请求完成时结束。
 */
async function handleSourceReview(input: ReviewPersonaDistillationSourcesInput): Promise<void> {
  await reviewSources(input)
}

/**
 * 保存人工编辑后的完整人物候选并启动重新评测。
 * @param input 页面提交的并发版本和候选正文。
 * @returns 请求完成时结束。
 */
async function handleCandidateSave(input: SavePersonaDistillationCandidateInput): Promise<void> {
  await saveCandidate(input)
}

/**
 * 确认已评测候选并在创建或更新成功后进入人物工作区。
 * @param input 页面提交的并发版本、人物名称和候选哈希。
 * @returns 创建及导航完成时结束。
 */
async function handleCandidateConfirm(input: ConfirmPersonaDistillationCandidateInput): Promise<void> {
  const confirmed = await confirmCandidate(input)
  if (confirmed?.createdPersonaId) await navigateTo(`/personas/${confirmed.createdPersonaId}`)
}

/**
 * 从失败运行创建新运行并进入新工作区。
 * @returns 重试创建及导航完成时结束。
 */
async function handleRetry(): Promise<void> {
  const retried = await retryRun()
  if (retried) await navigateTo(`/personas/distillations/${retried.id}`)
}
</script>

<template>
  <div>
    <ContentPageHeader
      :title="run ? `人物蒸馏 · ${run.requestedName}` : '人物蒸馏工作区'"
      :description="run ? statusDescription(run.status, run.mode) : '读取可恢复的人物蒸馏运行。'"
    >
      <div class="flex flex-wrap gap-2">
        <UButton to="/personas" color="neutral" variant="ghost">返回人物列表</UButton>
        <UButton v-if="cancelable" color="error" variant="soft" icon="i-lucide-circle-stop" :loading="actionLoading" @click="cancelRun">
          取消运行
        </UButton>
      </div>
    </ContentPageHeader>

    <UAlert
      v-if="error || !run"
      color="error"
      title="人物蒸馏运行加载失败"
      description="运行可能不存在，或当前页面暂时无法连接服务端。"
      :actions="[{ label: '重试', onClick: () => refresh() }]"
    />

    <template v-else>
      <div class="workflow-steps" aria-label="人物蒸馏进度">
        <div
          v-for="(step, index) in workflowSteps"
          :key="step.label"
          class="workflow-step"
          :class="{ 'workflow-step--current': index === currentStep }"
          :aria-current="index === currentStep ? 'step' : undefined"
        >
          <span class="workflow-step-index">{{ index + 1 }}</span>
          <span><strong class="block">{{ step.label }}</strong><span class="block font-normal">{{ step.description }}</span></span>
        </div>
      </div>

      <UCard v-if="active" class="run-status-board mt-6">
        <div class="flex items-start gap-4">
          <UIcon name="i-lucide-loader-circle" class="mt-1 size-6 shrink-0 animate-spin" aria-hidden="true" />
          <div>
            <h2 class="font-semibold text-highlighted">{{ statusTitle(run.status, run.mode) }}</h2>
            <p class="mt-1 text-sm text-muted">{{ statusDescription(run.status, run.mode) }}</p>
            <p class="mt-3 text-xs text-muted">运行标识：{{ run.id }} · 上下文：{{ run.provider === 'openviking' ? 'OpenViking' : 'SQLite FTS5' }}</p>
          </div>
        </div>
      </UCard>

      <DistillationCoverageReview
        v-if="run.status === 'awaiting_source_review'"
        :run="run"
        :loading="actionLoading"
        @submit="handleSourceReview"
      />

      <DistillationCandidateReview
        v-else-if="run.status === 'awaiting_candidate_review'"
        :run="run"
        :loading="actionLoading"
        @save="handleCandidateSave"
        @confirm="handleCandidateConfirm"
      />

      <UCard v-else-if="run.status === 'failed'" class="mt-6">
        <UAlert color="error" :title="statusTitle(run.status, run.mode)" :description="run.errorMessage || statusDescription(run.status, run.mode)" />
        <div class="mt-4 flex flex-wrap justify-end gap-2">
          <UButton to="/personas" color="neutral" variant="ghost">返回人物列表</UButton>
          <UButton icon="i-lucide-refresh-cw" :loading="actionLoading" @click="handleRetry">使用固定输入重试</UButton>
        </div>
      </UCard>

      <UCard v-else-if="run.status === 'canceled'" class="mt-6">
        <UAlert color="neutral" :title="statusTitle(run.status, run.mode)" :description="statusDescription(run.status, run.mode)" />
      </UCard>

      <UCard v-else-if="run.status === 'completed'" class="mt-6">
        <UAlert color="success" :title="statusTitle(run.status, run.mode)" :description="statusDescription(run.status, run.mode)" />
        <div class="mt-4 flex justify-end">
          <UButton v-if="run.createdPersonaId" :to="`/personas/${run.createdPersonaId}`" icon="i-lucide-arrow-right">{{ run.mode === 'update' ? '返回人物工作区' : '进入人物工作区' }}</UButton>
        </div>
      </UCard>
    </template>
  </div>
</template>
