<script setup lang="ts">
import type { PublicTaskQueueStatus, SystemCapabilitiesResult } from '#shared/types/system'

/** 全局导航状态条的只读属性。 */
interface Props {
  /** 当前已登录管理员名称。 */
  username: string
  /** 持久后台任务队列摘要。 */
  taskQueue: PublicTaskQueueStatus
  /** 外部模型和上下文能力状态。 */
  capabilities: SystemCapabilitiesResult
}

defineProps<Props>()
</script>

<template>
  <div class="flex flex-wrap items-center justify-end gap-2 text-xs" aria-label="账户与系统状态">
    <span class="inline-flex items-center gap-1 text-muted">
      <UIcon name="i-lucide-user-round" aria-hidden="true" />
      {{ username }}
    </span>
    <UBadge color="neutral" variant="subtle">后台任务 {{ taskQueue.total }}</UBadge>
    <UBadge :color="capabilities.textModel.configured ? 'success' : 'error'" variant="subtle">
      {{ capabilities.textModel.configured ? '文本可用' : '文本关闭' }}
    </UBadge>
    <UBadge :color="capabilities.imageModel.configured ? 'success' : 'warning'" variant="subtle">
      {{ capabilities.imageModel.configured ? '图片可用' : '图片关闭' }}
    </UBadge>
    <UBadge color="neutral" variant="subtle">
      {{ capabilities.contextProvider === 'openviking' ? '语义检索' : '本地检索' }}
    </UBadge>
  </div>
</template>
