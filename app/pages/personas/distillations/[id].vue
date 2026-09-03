<script setup lang="ts">
import type {
  ConfirmPersonaDistillationCandidateInput,
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
  saveCandidate,
  confirmCandidate,
  cancelRun,
  retryRun,
} = await usePersonaDistillation(runId)

/** 人物自由蒸馏工作区对外展示的三个阶段。 */
const workflowSteps = computed(() => [
  { label: '自由分析', description: '模型理解资料与形成候选' },
  { label: '人工校准', description: '审阅分析和灵魂正文' },
  { label: '最终确认', description: run.value?.mode === 'update' ? '发布新灵魂' : '创建人物与灵魂' },
])

/** 当前运行状态对应的工作流位置。 */
const currentStep = computed(() => {
  if (!run.value) return 0
  if (run.value.status === 'analyzing') return 0
  if (run.value.status === 'awaiting_candidate_review') return 1
  return 2
})
/** 只有未终态运行可被取消。 */
const cancelable = computed(() => run.value ? ['analyzing', 'awaiting_candidate_review'].includes(run.value.status) : false)

/** @param status 当前人物蒸馏状态。 @param mode 创建或更新模式。 @returns 用户可理解的状态标题。 */
function statusTitle(status: PersonaDistillationStatus, mode: 'create' | 'update'): string {
  const titleByStatus: Record<PersonaDistillationStatus, string> = {
    analyzing: '正在自由分析人物资料',
    awaiting_candidate_review: '等待你校准并确认候选',
    completed: mode === 'update' ? '人物灵魂已更新' : '人物已经创建',
    failed: '人物蒸馏未完成',
    canceled: '人物蒸馏已取消',
  }
  return titleByStatus[status]
}

/** @param status 当前人物蒸馏状态。 @param mode 创建或更新模式。 @returns 用户可理解的状态说明。 */
function statusDescription(status: PersonaDistillationStatus, mode: 'create' | 'update'): string {
  const descriptionByStatus: Record<PersonaDistillationStatus, string> = {
    analyzing: '模型正在一次调用中自主理解固定资料、处理冲突与未知边界，并形成分析报告和人物候选。',
    awaiting_candidate_review: '审阅模型分析报告和候选灵魂；可以直接校准正文，不再触发另一轮模型评测。',
    completed: mode === 'update'
      ? '新灵魂版本已原子发布到原人物，旧版本仍保留在提示词历史中。'
      : '人物及初始当前灵魂版本已原子写入，可以进入人物工作区继续维护。',
    failed: '固定输入和错误已经保留。可以基于相同快照创建一次新运行。',
    canceled: mode === 'update'
      ? '运行已停在安全点，原人物和当前灵魂保持不变。'
      : '运行停在安全点且没有创建人物。',
  }
  return descriptionByStatus[status]
}

/** @param input 页面提交的候选正文。 @returns 请求完成时结束。 */
async function handleCandidateSave(input: SavePersonaDistillationCandidateInput): Promise<void> {
  await saveCandidate(input)
}

/** @param input 页面提交的名称和候选哈希。 @returns 创建及导航完成时结束。 */
async function handleCandidateConfirm(input: ConfirmPersonaDistillationCandidateInput): Promise<void> {
  const confirmed = await confirmCandidate(input)
  if (confirmed?.createdPersonaId) await navigateTo(`/personas/${confirmed.createdPersonaId}`)
}

/** @returns 重试创建及导航完成时结束。 */
async function handleRetry(): Promise<void> {
  const retried = await retryRun()
  if (retried) await navigateTo(`/personas/distillations/${retried.id}`)
}
</script>

<template>
  <div>
    <ContentPageHeader
      :title="run ? `人物自由蒸馏 · ${run.requestedName}` : '人物自由蒸馏工作区'"
      :description="run ? statusDescription(run.status, run.mode) : '读取可恢复的人物自由蒸馏运行。'"
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
      <div class="workflow-steps" aria-label="人物自由蒸馏进度">
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

      <DistillationCandidateReview
        v-if="run.status === 'awaiting_candidate_review'"
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
