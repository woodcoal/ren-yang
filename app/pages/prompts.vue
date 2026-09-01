<script setup lang="ts">
const route = useRoute()
const promptCode = typeof route.query.code === 'string' ? route.query.code : ''

await navigateTo({
  path: '/ai-algorithms',
  query: promptCode ? { prompt: promptCode } : route.query,
}, { replace: true })
</script>

<template>
  <div class="content-empty-state"><div><strong>正在进入 AI 管理</strong><p>生产调用使用的提示词已归入对应固定算法。</p></div></div>
</template>
