<script setup lang="ts">
import type { AnalysisBatchView } from '#shared/types/analysis'

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
}>()

/** @param status 批次状态。 @returns 通俗中文状态。 */
function statusLabel(status: AnalysisBatchView['status']): string {
  return { queued: '等待提炼', running: '提炼中', awaiting_review: '旧批次待审核', completed: '草稿已生成', failed: '提炼失败' }[status]
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h2 class="font-semibold text-highlighted">{{ title }} AI 提炼</h2><p class="mt-1 text-sm text-muted">AI 综合全部启用素材生成完整草稿；人工校准并发布后才会生效。</p></div>
        <div class="flex flex-wrap gap-2">
          <UButton size="sm" :loading="loading" @click="emit('analyze', 'incremental')">结合新增素材提炼</UButton>
          <UButton size="sm" color="neutral" variant="soft" :loading="loading" @click="emit('analyze', 'full_rebuild')">从全部素材重新提炼</UButton>
          <UButton size="sm" color="neutral" variant="ghost" :loading="loading" @click="emit('refresh')">刷新状态</UButton>
        </div>
      </div>
    </template>

    <p v-if="!batch" class="text-sm text-muted">还没有分析批次。</p>
    <template v-else>
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <UBadge :color="batch.status === 'failed' ? 'error' : batch.status === 'awaiting_review' ? 'warning' : 'neutral'" variant="soft">{{ statusLabel(batch.status) }}</UBadge>
        <span class="text-muted">{{ batch.mode === 'incremental' ? '结合新增素材' : '全部素材重建' }} · {{ batch.inputs.length }} 项输入</span>
      </div>
      <UAlert v-if="batch.errorMessage" class="mt-4" color="error" title="提炼没有完成" :description="batch.errorMessage" />
      <UAlert v-else-if="batch.status === 'completed'" class="mt-4" color="success" title="完整提示词草稿已生成" description="请在下方校准草稿，确认无误后发布。" />
      <p v-if="batch.resultSummary" class="mt-4 whitespace-pre-wrap text-sm leading-6 text-muted">{{ batch.resultSummary }}</p>
    </template>
  </UCard>
</template>
