<script setup lang="ts">
import type { ApiResponse } from '#shared/types/api'
import type { AiAlgorithmView } from '#shared/types/aiConfiguration'

const route = useRoute()
const promptCode = typeof route.query.code === 'string' ? route.query.code : ''
const { data } = await useFetch<ApiResponse<AiAlgorithmView[]>>('/api/v1/ai/algorithms')
const belongsToAlgorithm = data.value?.data.some(algorithm => algorithm.stepDefinitions.some(step => step.promptCode === promptCode)) ?? false

await navigateTo({
  path: belongsToAlgorithm ? '/ai-algorithms' : '/ai-settings',
  query: belongsToAlgorithm ? { prompt: promptCode } : route.query,
}, { replace: true })
</script>

<template>
  <div class="content-empty-state"><div><strong>正在进入新的 AI 管理页面</strong><p>算法步骤提示词已归入 AI 算法，其他提示词已归入 AI 设置。</p></div></div>
</template>
