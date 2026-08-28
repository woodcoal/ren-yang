<script setup lang="ts">
/** 页面标题属性。 */
interface Props {
  /** 页面主标题。 */
  title: string
  /** 页面职责说明。 */
  description: string
}

defineProps<Props>()
</script>

<template>
  <div class="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
    <div>
      <h1 class="text-2xl font-semibold text-highlighted">
        {{ title }}
      </h1>
      <p class="mt-1 max-w-3xl text-sm text-muted">
        {{ description }}
      </p>
    </div>
    <div class="flex shrink-0 gap-2">
      <slot />
    </div>
  </div>
</template>
