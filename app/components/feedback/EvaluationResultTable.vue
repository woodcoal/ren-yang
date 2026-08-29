<script setup lang="ts">
import type { EvaluationResultView } from '#shared/types/feedback'

const props = defineProps<{
  /** 按执行顺序排列的逐用例评测结果。 */
  results: EvaluationResultView[]
}>()
</script>

<template>
  <div v-if="props.results.length" class="space-y-4">
    <article v-for="result in props.results" :key="result.id" class="rounded-md border border-default p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-medium text-highlighted">{{ result.caseName }}</h3>
        <UBadge :color="result.status === 'passed' ? 'success' : 'error'" variant="subtle">{{ result.status === 'passed' ? '通过' : '失败' }}</UBadge>
      </div>
      <p class="mt-2 text-sm text-muted">基础评分 {{ result.baseScore.toFixed(2) }} · 候选评分 {{ result.candidateScore.toFixed(2) }}</p>
      <ul v-if="result.failures.length" class="mt-3 list-disc pl-5 text-sm text-error"><li v-for="failure in result.failures" :key="failure">{{ failure }}</li></ul>
      <div class="mt-4 grid gap-3 lg:grid-cols-2">
        <div class="rounded-md bg-elevated p-3"><p class="text-xs font-medium text-muted">基础版本输出</p><p class="mt-2 whitespace-pre-wrap text-sm">{{ result.baseOutput }}</p></div>
        <div class="rounded-md bg-elevated p-3"><p class="text-xs font-medium text-muted">候选版本输出</p><p class="mt-2 whitespace-pre-wrap text-sm">{{ result.candidateOutput }}</p></div>
      </div>
      <p class="mt-3 text-sm">{{ result.reasoningSummary }}</p>
    </article>
  </div>
  <p v-else class="py-6 text-center text-sm text-muted">评测尚未产生逐用例结果。</p>
</template>
