<script setup lang="ts">
const props = defineProps<{
  enabled: boolean
  subjectType: 'persona' | 'world'
  loading: boolean
}>()

const emit = defineEmits<{
  change: [enabled: boolean]
}>()

/**
 * 把 Nuxt UI 开关的新状态交给页面保存，不做本地乐观更新。
 * @param enabled 用户选择的新状态。
 * @returns 无返回值。
 */
function changeAutomation(enabled: boolean): void {
  emit('change', enabled)
}
</script>

<template>
  <UCard>
    <div class="flex items-start justify-between gap-6">
      <div>
        <h2 class="font-semibold text-highlighted">
          {{ props.subjectType === 'persona' ? '自动提炼并发布成长与记忆' : '自动提炼并发布成长' }}
        </h2>
        <p class="mt-1 text-sm text-muted">
          开启后，系统按后台统一周期检查新素材；有新内容时自动提炼并直接发布。关闭后不会创建定时分析任务。
        </p>
      </div>
      <USwitch
        :model-value="props.enabled"
        :disabled="props.loading"
        :aria-label="props.subjectType === 'persona' ? '人物自动提炼并发布' : '世界自动提炼并发布'"
        @update:model-value="changeAutomation"
      />
    </div>
  </UCard>
</template>
