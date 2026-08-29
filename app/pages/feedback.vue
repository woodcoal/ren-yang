<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreateEvaluationCaseInput } from '#shared/schemas/feedback'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary } from '#shared/types/content'
import type { EvaluationCaseView, FeedbackView } from '#shared/types/feedback'
import { getApiErrorMessage } from '../utils/apiError'

const [{ data: feedbackData, error: feedbackError, refresh: refreshFeedback }, { data: personaData }] = await Promise.all([
  useFetch<ApiResponse<FeedbackView[]>>('/api/v1/feedback'),
  useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas'),
])
const feedback = computed(() => feedbackData.value?.data ?? [])
const personas = computed(() => personaData.value?.data ?? [])
const selectedPersonaId = shallowRef(personas.value[0]?.id ?? '')
const evaluationCases = shallowRef<EvaluationCaseView[]>([])
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

/** @param timestamp UTC Unix 毫秒。 @returns 本地时间。 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <ContentPageHeader title="学习中心" description="在任务详情确认反馈用途；作为人物学习资料后，再到人物成长页分析和审核。" />
    <UAlert v-if="actionError" class="mb-5" color="error" title="操作失败" :description="actionError" />
    <UAlert v-if="actionMessage" class="mb-5" color="success" title="操作完成" :description="actionMessage" />

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
      <UCard>
        <template #header><div><h2 class="font-semibold text-highlighted">反馈记录</h2><p class="mt-1 text-sm text-muted">点击反馈返回任务详情，完成尚未确认的用途选择。</p></div></template>
        <UAlert v-if="feedbackError" color="error" title="反馈加载失败" :actions="[{ label: '重试', onClick: () => refreshFeedback() }]" />
        <div v-else-if="feedback.length" class="space-y-3">
          <NuxtLink v-for="item in feedback" :key="item.id" :to="`/runs/${item.runId}`" class="block rounded-md border border-default p-3 hover:bg-elevated">
            <div class="flex justify-between gap-3"><p class="text-sm">{{ item.content }}</p><UBadge color="neutral" variant="subtle">{{ item.confirmedTarget ?? `待确认：${item.suggestion.targetType}` }}</UBadge></div>
            <p class="mt-2 text-xs text-muted">{{ formatTime(item.createdAt) }}</p>
          </NuxtLink>
        </div>
        <p v-else class="py-5 text-center text-sm text-muted">尚无反馈记录。</p>
      </UCard>

      <UCard>
        <template #header><div><h2 class="font-semibold text-highlighted">人物回归用例</h2><p class="mt-1 text-sm text-muted">预先保存稳定场景，供后续灵魂修改提案评测复用。</p></div></template>
        <UFormField label="人物">
          <select v-model="selectedPersonaId" class="native-control" @change="loadEvaluationCases"><option value="">请选择人物</option><option v-for="persona in personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option></select>
        </UFormField>
        <ul v-if="evaluationCases.length" class="my-4 space-y-2 text-sm"><li v-for="item in evaluationCases" :key="item.id" class="rounded-md bg-elevated p-3"><strong>{{ item.name }}</strong><br><span class="text-muted">{{ item.category }} · {{ item.expectedChange }} · 最低 {{ item.minimumScore }}</span></li></ul>
        <p v-else class="my-4 text-sm text-muted">当前人物没有固定评测用例。</p>
        <FeedbackEvaluationCaseForm v-if="selectedPersonaId" :loading="caseLoading" @submit="createEvaluationCase" />
      </UCard>
    </div>
  </div>
</template>
