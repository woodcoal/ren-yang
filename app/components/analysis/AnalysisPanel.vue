<script setup lang="ts">
import type { AnalysisBatchView, ProposedLearningContentView } from '#shared/types/analysis'

defineProps<{
  /** 当前对象最新分析批次。 */
  batch: AnalysisBatchView | null
  /** 页面级动作是否正在执行。 */
  loading: boolean
  /** 分析对象通俗名称。 */
  title: string
}>()

const emit = defineEmits<{
  /** 创建增量或完整重建批次。 */
  analyze: [mode: 'incremental' | 'full_rebuild']
  /** 重新读取 Worker 执行状态。 */
  refresh: []
  /** 审核单项提案。 */
  review: [decision: {
    proposalId: string
    action: 'accept' | 'reject'
    reviewed?: ProposedLearningContentView | null
  }]
}>()

/** @param status 批次状态。 @returns 通俗中文状态。 */
function statusLabel(status: AnalysisBatchView['status']): string {
  return { queued: '等待分析', running: '分析中', awaiting_review: '等待审核', completed: '审核完成', failed: '分析失败' }[status]
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h2 class="font-semibold text-highlighted">{{ title }} AI 迭代</h2><p class="mt-1 text-sm text-muted">AI 只提出候选；接受前不会改变长期内容。</p></div>
        <div class="flex flex-wrap gap-2">
          <UButton size="sm" :loading="loading" @click="emit('analyze', 'incremental')">分析新增资料</UButton>
          <UButton size="sm" color="neutral" variant="soft" :loading="loading" @click="emit('analyze', 'full_rebuild')">完整重新分析</UButton>
          <UButton size="sm" color="neutral" variant="ghost" :loading="loading" @click="emit('refresh')">刷新状态</UButton>
        </div>
      </div>
    </template>

    <p v-if="!batch" class="text-sm text-muted">还没有分析批次。</p>
    <template v-else>
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <UBadge :color="batch.status === 'failed' ? 'error' : batch.status === 'awaiting_review' ? 'warning' : 'neutral'" variant="soft">{{ statusLabel(batch.status) }}</UBadge>
        <span class="text-muted">{{ batch.mode === 'incremental' ? '增量分析' : '完整重建' }} · {{ batch.inputs.length }} 项输入 · {{ batch.proposals.length }} 项提案</span>
      </div>
      <UAlert v-if="batch.errorMessage" class="mt-4" color="error" title="分析没有完成" :description="batch.errorMessage" />
      <div v-if="batch.proposals.length" class="mt-5 grid gap-4 xl:grid-cols-2">
        <AnalysisIterationProposalCard
          v-for="proposal in batch.proposals"
          :key="proposal.id"
          :proposal="proposal"
          :loading="loading"
          @review="emit('review', $event)"
        />
      </div>
    </template>
  </UCard>
</template>
