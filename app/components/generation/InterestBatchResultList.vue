<script setup lang="ts">
import type { InterestBatchItemView } from '#shared/types/generation'

defineProps<{
  /** 严格保持用户输入顺序的兴趣条目。 */
  items: InterestBatchItemView[]
  /** 当前正在创建单项重试任务的条目标识。 */
  retryingItemId: string | null
}>()

defineEmits<{
  /** 请求只重试一个失败条目。 */
  retry: [itemId: string]
}>()

/** 兴趣条目状态中文标签。 */
const statusLabels: Record<InterestBatchItemView['status'], string> = {
  queued: '排队中', running: '执行中', succeeded: '成功', failed: '失败',
}

/** 兴趣三态结论中文标签。 */
const decisionLabels: Record<NonNullable<InterestBatchItemView['decision']>, string> = {
  interested: '感兴趣', not_interested: '不感兴趣', insufficient_information: '信息不足',
}

/**
 * 把零至一之间的概率转换为整数百分比。
 * @param value 模型概率或置信度；尚无结果时为空。
 * @returns 百分比文本或占位符。
 */
function formatRatio(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

/**
 * 返回条目状态对应的 Nuxt UI 徽标颜色。
 * @param status 当前条目状态。
 * @returns 成功、失败或中性颜色。
 */
function statusColor(status: InterestBatchItemView['status']): 'success' | 'error' | 'neutral' {
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'error'
  return 'neutral'
}
</script>

<template>
  <div class="space-y-4">
    <UCard v-for="(item, index) in items" :key="item.itemId">
      <template #header>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="text-xs text-muted">第 {{ index + 1 }} 条 · {{ item.itemId }}</p>
            <h2 class="mt-1 font-semibold text-highlighted">{{ item.text }}</h2>
          </div>
          <UBadge :color="statusColor(item.status)" variant="subtle">{{ statusLabels[item.status] }}</UBadge>
        </div>
      </template>

      <div v-if="item.status === 'succeeded'" class="grid gap-3 text-sm sm:grid-cols-3">
        <div><p class="text-xs text-muted">结论</p><p class="mt-1 font-medium">{{ item.decision ? decisionLabels[item.decision] : '—' }}</p></div>
        <div><p class="text-xs text-muted">概率</p><p class="mt-1 font-medium">{{ formatRatio(item.probability) }}</p></div>
        <div><p class="text-xs text-muted">置信度</p><p class="mt-1 font-medium">{{ formatRatio(item.confidence) }}</p></div>
        <p class="sm:col-span-3"><span class="text-muted">理由：</span>{{ item.reason || '未返回理由' }}</p>
      </div>
      <UAlert
        v-else-if="item.error"
        color="error"
        :title="`${item.error.code}：${item.error.message}`"
      />
      <p v-else class="text-sm text-muted">等待批量模型调用返回结果。</p>

      <template #footer>
        <div class="flex flex-wrap justify-between gap-2">
          <UButton :to="`/runs/${item.runId}`" color="neutral" variant="ghost" size="sm">查看审计详情</UButton>
          <UButton
            v-if="item.status === 'failed'"
            size="sm"
            :loading="retryingItemId === item.itemId"
            @click="$emit('retry', item.itemId)"
          >重试此条</UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
