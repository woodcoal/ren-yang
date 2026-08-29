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
const pendingFeedbackCount = computed(() => feedback.value.filter(item => item.confirmedTarget === null).length)
const confirmedFeedbackCount = computed(() => feedback.value.length - pendingFeedbackCount.value)
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
    <ContentPageHeader title="所有后续变化，都先经过你的判断" description="反馈分类、人物成长和灵魂变化都必须由你确认；AI 只提供建议和分析依据。" />
    <div class="status-strip page-status-strip" aria-label="学习中心状态摘要">
      <div class="status-cell"><span class="status-kicker">全部反馈</span><strong class="status-value">{{ feedback.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">等待确认用途</span><strong class="status-value">{{ pendingFeedbackCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">已确认用途</span><strong class="status-value">{{ confirmedFeedbackCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">当前评测用例</span><strong class="status-value">{{ evaluationCases.length }}</strong></div>
    </div>
    <UAlert v-if="actionError" class="mb-5" color="error" title="操作失败" :description="actionError" />
    <UAlert v-if="actionMessage" class="mb-5" color="success" title="操作完成" :description="actionMessage" />

    <div class="content-notice mt-6">
      <UIcon name="i-lucide-sparkles" class="content-notice-icon" aria-hidden="true" />
      <div class="content-notice-copy"><strong>AI 分类只是建议</strong><p>是否影响人物、世界或仅处理本次结果，始终以你的明确选择为准。</p></div>
    </div>

    <div class="grid gap-6 py-9 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
      <section class="archive-panel" aria-labelledby="feedback-record-heading">
        <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">处理队列</p><h2 id="feedback-record-heading">一次只处理一项会改变后续表现的内容</h2><p>点击反馈返回原任务，在结果附近核对 AI 建议并确认用途。</p></div></div>
        <UAlert v-if="feedbackError" color="error" title="反馈加载失败" :actions="[{ label: '重试', onClick: () => refreshFeedback() }]" />
        <div v-else-if="feedback.length" class="log-list">
          <NuxtLink v-for="item in feedback" :key="item.id" :to="`/runs/${item.runId}`" class="log-row">
            <span class="log-row-meta">{{ formatTime(item.createdAt) }}</span>
            <span class="log-row-main"><strong class="log-row-title">{{ item.content }}</strong><span class="log-row-description">AI 建议：{{ item.suggestion.targetType }} · 仍需人工确认</span></span>
            <span class="log-row-end"><UBadge :color="item.confirmedTarget ? 'success' : 'warning'" variant="subtle">{{ item.confirmedTarget ?? '等待确认用途' }}</UBadge></span>
          </NuxtLink>
        </div>
        <p v-else class="py-5 text-center text-sm text-muted">尚无反馈记录。</p>
      </section>

      <section class="archive-panel" aria-labelledby="evaluation-case-heading">
        <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">回归检查</p><h2 id="evaluation-case-heading">人物回归用例</h2><p>保存稳定场景，供后续灵魂修改提案评测复用。</p></div></div>
        <UFormField label="人物">
          <select v-model="selectedPersonaId" class="native-control" @change="loadEvaluationCases"><option value="">请选择人物</option><option v-for="persona in personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option></select>
        </UFormField>
        <ul v-if="evaluationCases.length" class="my-4 space-y-2 text-sm"><li v-for="item in evaluationCases" :key="item.id" class="rounded-md bg-elevated p-3"><strong>{{ item.name }}</strong><br><span class="text-muted">{{ item.category }} · {{ item.expectedChange }} · 最低 {{ item.minimumScore }}</span></li></ul>
        <p v-else class="my-4 text-sm text-muted">当前人物没有固定评测用例。</p>
        <FeedbackEvaluationCaseForm v-if="selectedPersonaId" :loading="caseLoading" @submit="createEvaluationCase" />
      </section>
    </div>
  </div>
</template>
