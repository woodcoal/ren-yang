<script setup lang="ts">
import { computed } from 'vue'
import type { ArtifactBlockView } from '#shared/types/generation'

const props = defineProps<{
  /** 所属运行 UUID，用于构造受控图片读取地址。 */
  runId: string
  /** 单个产物块及不可覆盖尝试历史。 */
  block: ArtifactBlockView
  /** 页面是否正在执行写操作。 */
  loading?: boolean
  /** 运行处于活动状态时禁止会与 Worker 竞争的选择和锁定操作。 */
  actionsDisabled?: boolean
  /** 当前运行固定的单块累计尝试上限。 */
  maxAttempts?: number
}>()

defineEmits<{
  /** 请求追加一次单块尝试。 */
  retry: []
  /** 请求切换当前选中的成功尝试。 */
  select: [attemptId: string]
  /** 请求设置块锁定状态。 */
  lock: [locked: boolean]
}>()

/** 当前是否允许从终态追加单块尝试。 */
const canRetry = computed(() => ['succeeded', 'failed'].includes(props.block.status)
  && !props.block.isLocked
  && props.block.attempts.length < (props.maxAttempts ?? Number.POSITIVE_INFINITY))

/** @param timestamp 可空 UTC Unix 毫秒。 @returns 本地日期时间或占位文本。 */
function formatTime(timestamp: number | null): string {
  return timestamp === null ? '—' : new Date(timestamp).toLocaleString('zh-CN')
}

/** @param assetId 运行内图片资产 UUID。 @returns 需要登录授权的图片读取地址。 */
function assetUrl(assetId: string): string {
  return `/api/v1/runs/${encodeURIComponent(props.runId)}/assets/${encodeURIComponent(assetId)}`
}
</script>

<template>
  <article class="rounded-md border border-default p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="font-medium text-highlighted">{{ block.ordinal + 1 }}. {{ block.specKey }}</h3>
        <p class="mt-1 text-xs text-muted">{{ block.type === 'image' ? '图片块' : '文字块' }} · {{ block.role }}</p>
      </div>
      <div class="flex items-center gap-2">
        <UBadge v-if="block.isLocked" color="warning" variant="subtle">已锁定</UBadge>
        <UBadge color="neutral" variant="subtle">{{ block.status }}</UBadge>
      </div>
    </div>
    <p class="mt-3 text-sm text-muted">{{ block.instruction }}</p>

    <div v-if="block.attempts.length" class="mt-4 space-y-3">
      <details v-for="attempt in block.attempts" :key="attempt.id" :open="attempt.id === block.selectedAttemptId" class="rounded-md bg-elevated p-3">
        <summary class="cursor-pointer text-xs">
          尝试 {{ attempt.attemptNo }} · {{ attempt.status }} · {{ formatTime(attempt.completedAt) }}
          <span v-if="attempt.id === block.selectedAttemptId"> · 当前选中</span>
        </summary>
        <pre v-if="attempt.outputText" class="content-pre mt-3">{{ attempt.outputText }}</pre>
        <figure v-if="attempt.asset" class="mt-3">
          <img class="max-h-96 rounded-md object-contain" :src="assetUrl(attempt.asset.id)" :alt="attempt.asset.altText">
          <figcaption class="mt-2 text-xs text-muted">{{ attempt.asset.altText }} · {{ Math.ceil(attempt.asset.sizeBytes / 1024) }} KiB</figcaption>
        </figure>
        <p v-if="attempt.errorMessage" class="mt-3 text-sm text-error">{{ attempt.errorCode }}：{{ attempt.errorMessage }}</p>
        <p v-if="attempt.usage" class="mt-3 text-xs text-muted">用量：输入 {{ attempt.usage.inputTokens ?? '未知' }} · 输出 {{ attempt.usage.outputTokens ?? '未知' }} · 总计 {{ attempt.usage.totalTokens ?? '未知' }} Token</p>
        <UButton
          v-if="attempt.status === 'succeeded' && attempt.id !== block.selectedAttemptId"
          class="mt-3"
          size="xs"
          color="neutral"
          variant="soft"
          :disabled="loading || actionsDisabled"
          @click="$emit('select', attempt.id)"
        >选择此尝试</UButton>
      </details>
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
      <UButton v-if="canRetry" size="sm" color="neutral" variant="soft" :disabled="actionsDisabled" :loading="loading" @click="$emit('retry')">单块重试</UButton>
      <span v-else-if="block.attempts.length >= (maxAttempts ?? Number.POSITIVE_INFINITY)" class="self-center text-xs text-muted">已达到 {{ maxAttempts }} 次尝试上限</span>
      <UButton
        v-if="block.selectedAttemptId"
        size="sm"
        color="neutral"
        variant="ghost"
        :disabled="actionsDisabled"
        :loading="loading"
        @click="$emit('lock', !block.isLocked)"
      >{{ block.isLocked ? '解除锁定' : '锁定选中结果' }}</UButton>
    </div>
  </article>
</template>
