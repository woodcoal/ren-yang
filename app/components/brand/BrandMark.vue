<script setup lang="ts">
/** 品牌标志的展示属性。 */
interface Props {
  /** 是否显示品牌名称与正式副标题。 */
  showCopy?: boolean
}

withDefaults(defineProps<Props>(), {
  showCopy: true,
})
</script>

<template>
  <span class="brand-lockup">
    <svg class="brand-symbol" viewBox="0 0 24 24" aria-hidden="true">
      <circle class="brand-symbol-accent" cx="12" cy="4.6" r="2.6" />
      <path d="M10.3 10 3.7 20.4" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round" />
      <path class="brand-symbol-accent-stroke" d="m13.7 10 6.6 10.4" fill="none" stroke-width="4.4" stroke-linecap="round" />
    </svg>
    <span v-if="showCopy" class="brand-copy">
      <strong class="brand-name">人样</strong>
      <span class="brand-subtitle">Agents, with a human touch.</span>
    </span>
  </span>
</template>
