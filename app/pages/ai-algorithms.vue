<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { PublishAiAlgorithmConfigurationInput } from '#shared/schemas/aiConfiguration'
import type { ApiResponse } from '#shared/types/api'
import type { AiAlgorithmCode, AiAlgorithmView, AiModelDeploymentView } from '#shared/types/aiConfiguration'
import { getApiErrorMessage } from '../utils/apiError'

const [algorithmRequest, deploymentRequest] = await Promise.all([
  useFetch<ApiResponse<AiAlgorithmView[]>>('/api/v1/ai/algorithms'),
  useFetch<ApiResponse<AiModelDeploymentView[]>>('/api/v1/ai/model-deployments'),
])
const algorithms = computed(() => algorithmRequest.data.value?.data ?? [])
const deployments = computed(() => deploymentRequest.data.value?.data ?? [])
const configuredCount = computed(() => algorithms.value.filter(item => item.activeConfigurationVersion !== null).length)
const savingCode = shallowRef<AiAlgorithmCode | null>(null)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)

/**
 * 发布指定算法的一版完整配置并刷新算法列表。
 * @param code 固定算法编码。
 * @param input 全部固定步骤的模型与参数。
 * @returns 发布与刷新完成时结束。
 */
async function saveAlgorithm(code: AiAlgorithmCode, input: PublishAiAlgorithmConfigurationInput): Promise<void> {
  savingCode.value = code
  actionError.value = null
  actionMessage.value = null
  try {
    await $fetch(`/api/v1/ai/algorithms/${code}`, { method: 'PUT', body: input })
    await algorithmRequest.refresh()
    actionMessage.value = '算法配置新版本已发布，之后创建的任务将使用新快照。'
  }
  catch (error: unknown) {
    actionError.value = getApiErrorMessage(error, '算法配置发布失败')
  }
  finally {
    savingCode.value = null
  }
}
</script>

<template>
  <div>
    <ContentPageHeader title="AI 算法" description="流程和输出结构固定在代码中；这里只为每个步骤选择模型并调整调用参数。" />
    <div class="status-strip page-status-strip" aria-label="AI 算法状态摘要">
      <div class="status-cell"><span class="status-kicker">固定算法</span><strong class="status-value">{{ algorithms.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">已配置</span><strong class="status-value">{{ configuredCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">可用文本模型</span><strong class="status-value">{{ deployments.filter(item => item.modality === 'text' && item.isEnabled).length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">配置策略</span><strong class="status-value">版本化发布</strong></div>
    </div>
    <div class="space-y-5 py-9">
      <UAlert color="neutral" variant="subtle" title="算法边界" description="管理员不能从数据库增删步骤或改变顺序；提示词正文仍在提示词页面版本化维护，算法配置只绑定文本模型与温度、输出长度、超时。" />
      <UAlert v-if="algorithmRequest.error.value || deploymentRequest.error.value" color="error" title="算法配置加载失败" />
      <UAlert v-if="actionError" color="error" title="发布失败" :description="actionError" />
      <UAlert v-if="actionMessage" color="success" title="发布完成" :description="actionMessage" />
      <div v-if="algorithms.length" class="space-y-6">
        <AiConfigurationAiAlgorithmConfigurationCard
          v-for="algorithm in algorithms"
          :key="`${algorithm.code}-${algorithm.activeConfigurationVersion ?? 0}`"
          :algorithm="algorithm"
          :deployments="deployments"
          :loading="savingCode === algorithm.code"
          @save="saveAlgorithm(algorithm.code, $event)"
        />
      </div>
      <div v-else class="content-empty-state"><div><strong>算法定义不可用</strong><p>请检查数据库迁移是否完成。</p></div></div>
    </div>
  </div>
</template>
