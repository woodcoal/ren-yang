<script setup lang="ts">
import { computed } from 'vue'
import type { RunDetails, RunSummary } from '#shared/types/generation'

const props = defineProps<{
  /** 运行公开摘要。 */
  run: RunSummary
  /** 运行关联任务历史。 */
  tasks: RunDetails['tasks']
  /** 状态动作是否正在提交。 */
  loading?: boolean
}>()

defineEmits<{
  /** 请求协作式取消。 */
  cancel: []
  /** 请求创建新的手工重试任务。 */
  retry: []
}>()

/** 运行状态中文标签。 */
const statusLabels: Record<RunSummary['status'], string> = {
  planning: '规划中', awaiting_confirmation: '等待确认', queued: '排队中', running: '执行中',
  succeeded: '成功', partial: '部分成功', failed: '失败', canceled: '已取消',
}
const canCancel = computed(() => ['planning', 'awaiting_confirmation', 'queued', 'running'].includes(props.run.status))
const canRetry = computed(() => ['failed', 'partial'].includes(props.run.status))

/** @param timestamp UTC Unix 毫秒。 @returns 本地日期时间。 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div><h2 class="font-semibold text-highlighted">运行状态</h2><p class="mt-1 text-xs text-muted">{{ run.id }}</p></div>
        <UBadge :color="run.status === 'failed' ? 'error' : run.status === 'succeeded' ? 'success' : 'neutral'" variant="subtle">{{ statusLabels[run.status] }}</UBadge>
      </div>
    </template>
    <div class="grid gap-3 text-sm sm:grid-cols-2">
      <p><span class="text-muted">人物：</span>{{ run.personaName }}</p>
      <p><span class="text-muted">模型：</span>{{ run.model.model }}</p>
      <p v-if="run.imageModel"><span class="text-muted">图片模型：</span>{{ run.imageModel.model }}</p>
      <p><span class="text-muted">上下文：</span>{{ run.contextProvider }}</p>
      <p><span class="text-muted">已报告总 Token：</span>{{ run.usage?.totalTokens ?? '供应商未返回' }} / {{ run.parameters.maxTotalTokens }}</p>
      <p><span class="text-muted">创建：</span>{{ formatTime(run.createdAt) }}</p>
    </div>
    <UAlert v-if="run.errorMessage" class="mt-4" color="error" :title="run.errorCode || '运行失败'" :description="run.errorMessage" />
    <div v-if="tasks.length" class="mt-4 space-y-2">
      <div v-for="task in tasks" :key="task.id" class="flex flex-wrap justify-between gap-2 rounded-md bg-elevated px-3 py-2 text-xs">
        <span>{{ task.type }} · {{ task.status }}</span><span>尝试 {{ task.attemptCount }}/{{ task.maxAttempts }}</span>
      </div>
    </div>
    <template #footer>
      <div class="flex gap-2">
        <UButton v-if="canCancel" color="error" variant="soft" :loading="loading" @click="$emit('cancel')">取消运行</UButton>
        <UButton v-if="canRetry" :loading="loading" @click="$emit('retry')">重新执行</UButton>
      </div>
    </template>
  </UCard>
</template>
