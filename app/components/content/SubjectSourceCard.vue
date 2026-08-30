<script setup lang="ts">
import type { SourceSummary } from '#shared/types/content'

/** 人物或世界资料卡属性。 */
interface Props {
  /** 当前展示的资料摘要。 */
  source: SourceSummary
  /** 页面是否正在执行资料写操作。 */
  loading: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  /** 请求修改资料全局启用状态。 */
  status: [source: SourceSummary]
  /** 请求解除资料与当前人物或世界的关联。 */
  unlink: [source: SourceSummary]
}>()

/** 资料用途对应的通俗中文名称。 */
const roleLabels: Record<SourceSummary['role'], string> = {
  canon_fact: '原作事实',
  reference: '背景参考',
  style_sample: '写作风格参考',
}
</script>

<template>
  <UCard class="relative">
    <NuxtLink
      :to="`/sources/${props.source.id}`"
      :aria-label="`查看资料详情：${props.source.name}`"
      class="absolute inset-0 z-0 rounded-[var(--radius-panel)] focus-visible:outline-3 focus-visible:outline-primary/25"
    />
    <div class="pointer-events-none relative z-10 flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <strong class="block truncate font-medium text-highlighted">{{ props.source.name }}</strong>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <UBadge color="neutral" variant="subtle">{{ roleLabels[props.source.role] }}</UBadge>
          <UBadge :color="props.source.isEnabled ? 'success' : 'neutral'" variant="subtle">{{ props.source.isEnabled ? '已启用' : '已禁用' }}</UBadge>
        </div>
        <p class="mt-3 line-clamp-3 text-sm leading-6 text-muted">{{ props.source.contentText }}</p>
      </div>
      <div class="pointer-events-auto flex shrink-0 gap-1">
        <UButton
          :icon="props.source.isEnabled ? 'i-lucide-circle-pause' : 'i-lucide-circle-play'"
          :aria-label="`${props.source.isEnabled ? '禁用' : '启用'}资料：${props.source.name}`"
          :color="props.source.isEnabled ? 'error' : 'success'"
          variant="ghost"
          size="xs"
          :disabled="props.loading"
          @click="emit('status', props.source)"
        />
        <UButton
          icon="i-lucide-unlink"
          :aria-label="`解除资料关联：${props.source.name}`"
          color="error"
          variant="ghost"
          size="xs"
          :disabled="props.loading"
          @click="emit('unlink', props.source)"
        />
      </div>
    </div>
  </UCard>
</template>
