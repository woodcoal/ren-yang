<script setup lang="ts">
import { reactive } from 'vue'
import type { IterationProposalView, ProposedLearningContentView } from '#shared/types/analysis'

const props = defineProps<{
  /** 当前待审核提案。 */
  proposal: IterationProposalView
  /** 页面级动作是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 提交单项接受或拒绝决定。 */
  review: [decision: {
    proposalId: string
    action: 'accept' | 'reject'
    reviewed?: ProposedLearningContentView | null
  }]
}>()

const reviewed = reactive({
  content: props.proposal.proposed?.content ?? '',
  scope: props.proposal.proposed?.scope ?? '',
  importance: props.proposal.proposed?.importance ?? 3,
  memoryType: props.proposal.proposed?.memoryType,
})

/** @returns 无返回值。 */
function accept(): void {
  const needsContent = ['add', 'revise', 'merge', 'supersede'].includes(props.proposal.operation)
  if (needsContent && (!reviewed.content.trim() || !reviewed.scope.trim())) return
  emit('review', {
    proposalId: props.proposal.id,
    action: 'accept',
    reviewed: needsContent
      ? {
          content: reviewed.content.trim(),
          scope: reviewed.scope.trim(),
          importance: reviewed.importance,
          ...(reviewed.memoryType ? { memoryType: reviewed.memoryType } : {}),
        }
      : null,
  })
}

/** @returns 无返回值。 */
function reject(): void {
  emit('review', { proposalId: props.proposal.id, action: 'reject' })
}

/** @param operation 提案操作。 @returns 通俗中文名称。 */
function operationLabel(operation: IterationProposalView['operation']): string {
  return { add: '新增', revise: '修订', merge: '合并', supersede: '取代', archive: '建议停用', no_change: '保持不变' }[operation]
}
</script>

<template>
  <article class="analysis-proposal">
    <div class="flex flex-wrap items-center gap-2">
      <UBadge variant="soft">{{ operationLabel(proposal.operation) }}</UBadge>
      <span class="text-xs text-muted">{{ proposal.evidenceInputIds.length }} 项依据</span>
      <UBadge v-if="proposal.conflicts.length" color="warning" variant="soft">有冲突</UBadge>
    </div>
    <p class="mt-2 text-sm text-muted">{{ proposal.rationale }}</p>
    <div v-if="proposal.conflicts.length" class="mt-3 rounded-md border border-warning/30 p-3 text-sm text-warning">
      <p v-for="conflict in proposal.conflicts" :key="conflict">{{ conflict }}</p>
    </div>
    <div v-if="proposal.proposed" class="mt-4 grid gap-3">
      <UFormField label="最终内容"><UTextarea v-model="reviewed.content" class="w-full" :rows="3" /></UFormField>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="适用范围"><UInput v-model="reviewed.scope" class="w-full" /></UFormField>
        <UFormField label="重要程度"><UInput v-model.number="reviewed.importance" type="number" min="1" max="5" class="w-full" /></UFormField>
      </div>
    </div>
    <div v-if="proposal.status === 'pending'" class="mt-4 flex flex-wrap gap-2">
      <UButton size="sm" :loading="loading" @click="accept">接受并应用</UButton>
      <UButton size="sm" color="error" variant="soft" :loading="loading" @click="reject">拒绝</UButton>
    </div>
    <p v-else class="mt-3 text-xs text-muted">该提案已{{ proposal.status === 'applied' ? '应用' : '拒绝' }}。</p>
  </article>
</template>
