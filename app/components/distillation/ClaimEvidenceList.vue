<script setup lang="ts">
import { computed } from 'vue'
import type {
  PersonaDistillationClaimBasis,
  PersonaDistillationClaimCategory,
  PersonaDistillationClaimView,
  PersonaDistillationInputView,
} from '#shared/types/personaDistillation'

/** 认知候选和证据列表属性。 */
interface Props {
  /** 程序校验后的全部认知候选。 */
  claims: PersonaDistillationClaimView[]
  /** 用于解析证据来源名称的运行输入。 */
  inputs: PersonaDistillationInputView[]
}

const props = defineProps<Props>()
const usableClaimCount = computed(() => props.claims.filter(claim => claim.status !== 'rejected').length)
const rejectedClaimCount = computed(() => props.claims.filter(claim => claim.status === 'rejected').length)

/**
 * 查找一项运行输入的用户可见名称。
 * @param inputId 运行内输入 UUID。
 * @returns 资料名称或稳定占位文本。
 */
function inputName(inputId: string): string {
  return props.inputs.find(input => input.id === inputId)?.name ?? '未知运行输入'
}

/**
 * 将候选分类转换为通俗名称。
 * @param category 固定候选分类。
 * @returns 用户可见的中文名称。
 */
function claimCategoryLabel(category: PersonaDistillationClaimCategory): string {
  return ({
    mental_model: '心智模型',
    decision_heuristic: '决策启发式',
    expression: '表达方式',
    value: '价值取向',
    anti_pattern: '反模式',
    tension: '内在张力',
    honesty_boundary: '诚实边界',
    timeline: '时间线',
  })[category]
}

/**
 * 将候选依据类型转换为通俗名称。
 * @param basis 固定候选依据类型。
 * @returns 用户可见的中文名称。
 */
function claimBasisLabel(basis: PersonaDistillationClaimBasis): string {
  return ({ explicit: '本人明确表达', observed: '行为观察', inferred: '系统推断' })[basis]
}
</script>

<template>
  <section aria-labelledby="distillation-claims-heading">
    <div class="section-heading">
      <div class="section-heading-copy">
        <h3 id="distillation-claims-heading">认知候选与证据</h3>
        <p>{{ usableClaimCount }} 项进入综合，{{ rejectedClaimCount }} 项被程序门禁拒绝。</p>
      </div>
    </div>
    <div class="space-y-3">
      <details v-for="claim in claims" :key="claim.id" class="rounded-lg border border-default bg-default p-4">
        <summary class="cursor-pointer list-none">
          <div class="flex flex-wrap items-center gap-2">
            <UBadge color="neutral" variant="subtle">{{ claimCategoryLabel(claim.category) }}</UBadge>
            <UBadge :color="claim.status === 'rejected' ? 'error' : claim.status === 'warning' ? 'warning' : 'success'" variant="subtle">
              {{ claim.status === 'rejected' ? '已拒绝' : claim.status === 'warning' ? '有限采用' : '可采用' }}
            </UBadge>
            <span class="font-medium text-highlighted">{{ claim.statement }}</span>
          </div>
        </summary>
        <div class="mt-4 space-y-3 text-sm">
          <p><strong>依据：</strong>{{ claimBasisLabel(claim.basis) }}；{{ claim.independentSourceCount }} 个独立来源。</p>
          <p><strong>适用条件：</strong>{{ claim.applicability }}</p>
          <p><strong>局限：</strong>{{ claim.limitations || '未补充具体局限。' }}</p>
          <UAlert v-for="warning in claim.warnings" :key="warning" color="warning" variant="subtle" title="采用限制" :description="warning" />
          <UAlert v-for="reason in claim.rejectionReasons" :key="reason" color="error" variant="subtle" title="拒绝原因" :description="reason" />
          <div v-for="evidence in claim.evidence" :key="evidence.id" class="rounded-md bg-elevated p-3">
            <p class="text-xs text-muted">{{ evidence.relation === 'supporting' ? '支持证据' : '反对证据' }} · {{ inputName(evidence.inputId) }}</p>
            <blockquote class="mt-2 border-l-2 border-default pl-3 text-default">{{ evidence.quote }}</blockquote>
          </div>
        </div>
      </details>
    </div>
  </section>
</template>
