<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { EvaluationRunView } from '#shared/types/feedback'

const route = useRoute()
const evaluationRunId = String(route.params.id)
const { data, error, refresh } = await useFetch<ApiResponse<EvaluationRunView>>(`/api/v1/evaluation-runs/${evaluationRunId}`)
const evaluation = computed(() => data.value?.data ?? null)
const active = computed(() => evaluation.value ? ['queued', 'running'].includes(evaluation.value.status) : false)
const pollingTimer = shallowRef<ReturnType<typeof setInterval> | null>(null)

/** @returns 为排队或运行中的评测启动两秒轮询。 */
function startPolling(): void {
  if (pollingTimer.value || !active.value) return
  pollingTimer.value = setInterval(() => { void refresh() }, 2_000)
}

/** @returns 停止轮询并释放计时器。 */
function stopPolling(): void {
  if (!pollingTimer.value) return
  clearInterval(pollingTimer.value)
  pollingTimer.value = null
}

watch(active, value => value ? startPolling() : stopPolling())
onMounted(startPolling)
onUnmounted(stopPolling)

/** @param timestamp 可空 UTC Unix 毫秒。 @returns 本地时间或占位符。 */
function formatTime(timestamp: number | null): string {
  return timestamp === null ? '—' : new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <ContentPageHeader title="人物评测" description="固定模型、参数和提示版本逐用例比较基础人物与候选人物；模型评分仅作为证据。">
      <UButton to="/feedback" color="neutral" variant="ghost">返回反馈与版本</UButton>
    </ContentPageHeader>
    <UAlert v-if="error || !evaluation" color="error" title="评测运行加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <template v-else>
      <UCard class="mb-6">
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><p class="text-xs text-muted">状态</p><p class="mt-1 font-medium">{{ evaluation.status }}</p></div>
          <div><p class="text-xs text-muted">用例</p><p class="mt-1 font-medium">{{ evaluation.passedCases }} / {{ evaluation.totalCases }} 通过</p></div>
          <div><p class="text-xs text-muted">模型</p><p class="mt-1 font-medium">{{ evaluation.model.model }}</p></div>
          <div><p class="text-xs text-muted">完成时间</p><p class="mt-1 font-medium">{{ formatTime(evaluation.completedAt) }}</p></div>
        </div>
        <p class="mt-4 break-all text-xs text-muted">候选版本 {{ evaluation.candidateVersionId }} · 提示 {{ evaluation.promptVersion }}</p>
      </UCard>
      <UAlert v-if="active" class="mb-6" color="info" title="后台评测执行中" description="页面每两秒读取一次持久状态，刷新或离开页面不会重复创建任务。" />
      <FeedbackEvaluationResultTable :results="evaluation.results" />
    </template>
  </div>
</template>
