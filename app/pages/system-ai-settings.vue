<script setup lang="ts">
const route = useRoute()

await navigateTo({ path: '/ai-settings', query: route.query }, { replace: true })
</script>

<template>
  <div class="content-empty-state"><div><strong>正在进入 AI 设置</strong><p>系统 AI 参数已合并到 AI 设置。</p></div></div>
</template>
