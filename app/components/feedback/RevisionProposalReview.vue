<script setup lang="ts">
import { shallowRef } from 'vue'
import type { RevisionProposalView } from '#shared/types/feedback'

const props = withDefaults(defineProps<{
  /** 待审查提案。 */
  proposal: RevisionProposalView
  /** 当前操作锁。 */
  loading?: boolean
}>(), { loading: false })

const emit = defineEmits<{
  /** 请求创建后台评测。 */
  evaluate: []
  /** 明确人工发布。 */
  publish: []
  /** 带原因拒绝提案。 */
  reject: [reason: string]
}>()

const rejectionReason = shallowRef('')
const localError = shallowRef<string | null>(null)

/** @returns 校验拒绝原因后发出拒绝意图。 */
function reject(): void {
  localError.value = null
  if (!rejectionReason.value.trim()) {
    localError.value = '拒绝提案必须填写原因'
    return
  }
  emit('reject', rejectionReason.value.trim())
}

/** @param value UTC Unix 毫秒。 @returns 本地时间。 */
function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN')
}
</script>

<template>
  <article class="rounded-md border border-default p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="font-medium text-highlighted">提案 {{ props.proposal.id }}</p>
        <p class="mt-1 text-xs text-muted">{{ formatTime(props.proposal.createdAt) }} · 候选版本 {{ props.proposal.candidateVersionId }}</p>
      </div>
      <div class="flex gap-2">
        <UBadge :color="props.proposal.riskLevel === 'low' ? 'success' : 'warning'" variant="subtle">{{ props.proposal.riskLevel }}</UBadge>
        <UBadge color="neutral" variant="subtle">{{ props.proposal.status }}</UBadge>
      </div>
    </div>

    <div class="mt-4 space-y-3">
      <div v-for="patch in props.proposal.patches" :key="patch.field" class="rounded-md bg-elevated p-3">
        <p class="text-sm font-medium text-highlighted">{{ patch.field }}</p>
        <div class="mt-2 grid gap-3 lg:grid-cols-2">
          <div><p class="text-xs text-muted">修改前</p><p class="mt-1 whitespace-pre-wrap text-sm">{{ patch.before || '（空）' }}</p></div>
          <div><p class="text-xs text-muted">修改后</p><p class="mt-1 whitespace-pre-wrap text-sm">{{ patch.after || '（空）' }}</p></div>
        </div>
        <p class="mt-2 text-xs text-muted">理由：{{ patch.reason }}</p>
      </div>
    </div>
    <ul class="mt-4 list-disc pl-5 text-sm text-muted"><li v-for="reason in props.proposal.riskReasons" :key="reason">{{ reason }}</li></ul>
    <UAlert v-if="props.proposal.hasEvidenceConflict" class="mt-4" color="warning" title="存在未解决证据冲突" description="冲突解除前发布门禁会阻止候选版本进入当前人物。" />
    <p v-if="props.proposal.decisionReason" class="mt-4 text-sm">决策记录：{{ props.proposal.decisionReason }}</p>

    <div v-if="!['published', 'rejected'].includes(props.proposal.status)" class="mt-5 space-y-3 border-t border-default pt-4">
      <div class="flex flex-wrap gap-2">
        <UButton v-if="props.proposal.status !== 'ready'" :loading="props.loading" icon="i-lucide-flask-conical" @click="emit('evaluate')">运行评测</UButton>
        <UButton v-if="props.proposal.status === 'ready'" :loading="props.loading" color="success" icon="i-lucide-check" @click="emit('publish')">人工确认并发布</UButton>
      </div>
      <UFormField label="拒绝原因"><UTextarea v-model="rejectionReason" :rows="2" /></UFormField>
      <p v-if="localError" class="text-sm text-error" role="alert">{{ localError }}</p>
      <UButton :loading="props.loading" color="error" variant="soft" @click="reject">拒绝提案</UButton>
    </div>
  </article>
</template>
