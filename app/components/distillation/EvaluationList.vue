<script setup lang="ts">
import type { PersonaDistillationEvaluationView } from '#shared/types/personaDistillation'

/** 候选六类评测列表属性。 */
interface Props {
  /** 与当前候选正文哈希绑定的评测。 */
  evaluations: PersonaDistillationEvaluationView[]
}

defineProps<Props>()

/**
 * 读取评测公开输出中的摘要，不解释或展示未知模型结构。
 * @param evaluation 当前候选的一项评测。
 * @returns 可安全展示的摘要或稳定占位文本。
 */
function evaluationSummary(evaluation: PersonaDistillationEvaluationView): string {
  const output = evaluation.output
  if (output && typeof output === 'object' && 'summary' in output && typeof output.summary === 'string') return output.summary
  return '本项评测未提供公开摘要。'
}

/**
 * 将评测维度转换为通俗名称。
 * @param type 固定评测维度。
 * @returns 用户可见的中文名称。
 */
function evaluationTypeLabel(type: PersonaDistillationEvaluationView['evaluationType']): string {
  return ({
    known_fact: '已知事实',
    decision_tendency: '决策倾向',
    unknown_boundary: '未知边界',
    expression: '表达方式',
    counterfactual: '反事实诱导',
    conflict_handling: '冲突处理',
  })[type]
}

/**
 * 将评测状态转换为通俗名称。
 * @param status 固定评测状态。
 * @returns 用户可见的中文名称。
 */
function evaluationStatusLabel(status: PersonaDistillationEvaluationView['status']): string {
  return ({ passed: '通过', warning: '提醒', failed: '未通过' })[status]
}

/**
 * 将评测状态转换为 Nuxt UI 语义颜色。
 * @param status 固定评测状态。
 * @returns 对应的成功、警告或错误颜色。
 */
function evaluationStatusColor(status: PersonaDistillationEvaluationView['status']): 'success' | 'warning' | 'error' {
  if (status === 'passed') return 'success'
  if (status === 'warning') return 'warning'
  return 'error'
}
</script>

<template>
  <UCard>
    <template #header><h3 class="font-semibold text-highlighted">六类评测</h3></template>
    <div class="space-y-3">
      <article v-for="evaluation in evaluations" :key="evaluation.id" class="rounded-lg border border-default p-3">
        <div class="flex items-center justify-between gap-3">
          <h4 class="text-sm font-medium text-highlighted">{{ evaluationTypeLabel(evaluation.evaluationType) }}</h4>
          <UBadge :color="evaluationStatusColor(evaluation.status)" variant="subtle">{{ evaluationStatusLabel(evaluation.status) }}</UBadge>
        </div>
        <p class="mt-2 text-sm text-muted">{{ evaluationSummary(evaluation) }}</p>
        <ul v-if="evaluation.failureReasons.length" class="mt-2 list-disc space-y-1 pl-5 text-sm text-error">
          <li v-for="reason in evaluation.failureReasons" :key="reason">{{ reason }}</li>
        </ul>
      </article>
    </div>
  </UCard>
</template>
