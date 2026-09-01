<script setup lang="ts">
const route = useRoute()
const prompt = typeof route.query.code === 'string' ? route.query.code : undefined

await navigateTo({
  path: '/ai-algorithms',
  query: prompt ? { algorithm: route.query.algorithm, prompt } : route.query,
}, { replace: true })
</script>

<template>
  <div class="content-empty-state">
    <div><strong>正在进入 AI 管理</strong><p>原 AI 设置已由对应固定算法统一接管。</p></div>
  </div>
</template>
