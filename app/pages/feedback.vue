<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreateEvaluationCaseInput } from '#shared/schemas/feedback'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary } from '#shared/types/content'
import type {
  CreatedEvaluationRun,
  EvaluationCaseView,
  FeedbackView,
  RevisionProposalView,
} from '#shared/types/feedback'
import { getApiErrorMessage } from '../utils/apiError'

const [{ data: feedbackData, error: feedbackError, refresh: refreshFeedback }, { data: proposalData, error: proposalError, refresh: refreshProposals }, { data: personaData }] = await Promise.all([
  useFetch<ApiResponse<FeedbackView[]>>('/api/v1/feedback'),
  useFetch<ApiResponse<RevisionProposalView[]>>('/api/v1/revision-proposals'),
  useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas'),
])
const feedback = computed(() => feedbackData.value?.data ?? [])
const proposals = computed(() => proposalData.value?.data ?? [])
const personas = computed(() => personaData.value?.data ?? [])
const selectedPersonaId = shallowRef(personas.value[0]?.id ?? '')
const evaluationCases = shallowRef<EvaluationCaseView[]>([])
const actionProposalId = shallowRef<string | null>(null)
const caseLoading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)

if (selectedPersonaId.value) await loadEvaluationCases()

/** @returns 重新读取当前人物评测用例。 */
async function loadEvaluationCases(): Promise<void> {
  if (!selectedPersonaId.value) {
    evaluationCases.value = []
    return
  }
  try {
    const response = await $fetch<ApiResponse<EvaluationCaseView[]>>(`/api/v1/personas/${selectedPersonaId.value}/evaluation-cases`)
    evaluationCases.value = response.data
  }
  catch (error: unknown) {
    actionError.value = getApiErrorMessage(error, '评测用例加载失败')
  }
}

/** @param input 新评测用例。 @returns 创建并刷新当前人物用例。 */
async function createEvaluationCase(input: CreateEvaluationCaseInput): Promise<void> {
  if (!selectedPersonaId.value || caseLoading.value) return
  caseLoading.value = true
  actionError.value = null
  try {
    await $fetch(`/api/v1/personas/${selectedPersonaId.value}/evaluation-cases`, { method: 'POST', body: input })
    actionMessage.value = '评测用例已创建'
    await loadEvaluationCases()
  }
  catch (error: unknown) {
    actionError.value = getApiErrorMessage(error, '评测用例创建失败')
  }
  finally {
    caseLoading.value = false
  }
}

/** @param proposalId 提案 UUID。 @returns 创建后台评测并进入评测详情。 */
async function evaluateProposal(proposalId: string): Promise<void> {
  await executeProposalAction(proposalId, async () => {
    const response = await $fetch<ApiResponse<CreatedEvaluationRun>>(`/api/v1/revision-proposals/${proposalId}/evaluate`, { method: 'POST' })
    await navigateTo(`/evaluations/${response.data.evaluationRunId}`)
  })
}

/** @param proposalId 提案 UUID。 @returns 明确人工发布并刷新。 */
async function publishProposal(proposalId: string): Promise<void> {
  await executeProposalAction(proposalId, async () => {
    await $fetch(`/api/v1/revision-proposals/${proposalId}/publish`, { method: 'POST', body: { confirmed: true } })
    actionMessage.value = '候选人物版本已发布'
  })
}

/** @param proposalId 提案 UUID。 @param reason 拒绝原因。 @returns 拒绝并刷新。 */
async function rejectProposal(proposalId: string, reason: string): Promise<void> {
  await executeProposalAction(proposalId, async () => {
    await $fetch(`/api/v1/revision-proposals/${proposalId}/reject`, { method: 'POST', body: { reason } })
    actionMessage.value = '提案已拒绝并保留审计记录'
  })
}

/** @param proposalId 提案 UUID。 @param action 单次写操作。 @returns 统一处理锁、错误和刷新。 */
async function executeProposalAction(proposalId: string, action: () => Promise<void>): Promise<void> {
  if (actionProposalId.value) return
  actionProposalId.value = proposalId
  actionError.value = null
  actionMessage.value = null
  try {
    await action()
    await Promise.all([refreshFeedback(), refreshProposals()])
  }
  catch (error: unknown) {
    actionError.value = getApiErrorMessage(error, '提案操作失败')
  }
  finally {
    actionProposalId.value = null
  }
}

/** @param timestamp UTC Unix 毫秒。 @returns 本地时间。 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <ContentPageHeader title="反馈与版本" description="原始反馈只追加保存；人物变化必须经过分类确认、候选版本、评测和风险门禁。" />
    <UAlert v-if="actionError" class="mb-5" color="error" title="操作失败" :description="actionError" />
    <UAlert v-if="actionMessage" class="mb-5" color="success" title="操作完成" :description="actionMessage" />

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
      <section class="space-y-4">
        <h2 class="text-lg font-semibold text-highlighted">修订提案</h2>
        <UAlert v-if="proposalError" color="error" title="提案加载失败" :actions="[{ label: '重试', onClick: () => refreshProposals() }]" />
        <template v-else-if="proposals.length">
          <FeedbackRevisionProposalReview
            v-for="proposal in proposals"
            :key="proposal.id"
            :proposal="proposal"
            :loading="actionProposalId === proposal.id"
            @evaluate="evaluateProposal(proposal.id)"
            @publish="publishProposal(proposal.id)"
            @reject="rejectProposal(proposal.id, $event)"
          />
        </template>
        <UCard v-else><p class="py-6 text-center text-sm text-muted">尚无长期人物修订提案。</p></UCard>
      </section>

      <div class="space-y-6">
        <UCard>
          <template #header><h2 class="font-semibold text-highlighted">人物回归用例</h2></template>
          <UFormField label="人物">
            <select v-model="selectedPersonaId" class="native-control" @change="loadEvaluationCases"><option value="">请选择人物</option><option v-for="persona in personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option></select>
          </UFormField>
          <ul v-if="evaluationCases.length" class="my-4 space-y-2 text-sm"><li v-for="item in evaluationCases" :key="item.id" class="rounded-md bg-elevated p-3"><strong>{{ item.name }}</strong><br><span class="text-muted">{{ item.category }} · {{ item.expectedChange }} · 最低 {{ item.minimumScore }}</span></li></ul>
          <p v-else class="my-4 text-sm text-muted">当前人物没有固定评测用例。</p>
          <FeedbackEvaluationCaseForm v-if="selectedPersonaId" :loading="caseLoading" @submit="createEvaluationCase" />
        </UCard>

        <UCard>
          <template #header><h2 class="font-semibold text-highlighted">反馈事件</h2></template>
          <UAlert v-if="feedbackError" color="error" title="反馈加载失败" :actions="[{ label: '重试', onClick: () => refreshFeedback() }]" />
          <div v-else-if="feedback.length" class="space-y-3">
            <NuxtLink v-for="item in feedback" :key="item.id" :to="`/runs/${item.runId}`" class="block rounded-md border border-default p-3 hover:bg-elevated">
              <div class="flex justify-between gap-3"><p class="text-sm">{{ item.content }}</p><UBadge color="neutral" variant="subtle">{{ item.confirmedTarget ?? `建议 ${item.suggestion.targetType}` }}</UBadge></div>
              <p class="mt-2 text-xs text-muted">{{ formatTime(item.createdAt) }}</p>
            </NuxtLink>
          </div>
          <p v-else class="py-5 text-center text-sm text-muted">尚无反馈事件。</p>
        </UCard>
      </div>
    </div>
  </div>
</template>
