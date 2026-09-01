<script setup lang="ts">
const route = useRoute()

await navigateTo({ path: '/ai-algorithms', query: route.query }, { replace: true })
</script>

<template>
  <div class="content-empty-state"><div><strong>正在进入 AI 管理</strong><p>系统 AI 参数已由对应固定算法接管。</p></div></div>
</template>
