<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import { systemAiSettingsValuesSchema, type SystemAiSettingsValues } from '#shared/schemas/systemAi'
import type { ApiResponse } from '#shared/types/api'
import type { SystemAiSettingsView } from '#shared/types/systemAi'
import { getApiErrorMessage } from '../utils/apiError'

const { data, error, refresh } = await useFetch<ApiResponse<SystemAiSettingsView>>('/api/v1/system/ai-settings')
const values = reactive<SystemAiSettingsValues>(systemAiSettingsValuesSchema.parse(data.value?.data.values ?? {
  interestAnalysis: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000, maxEvidenceChunks: 8 },
  contentAnalysis: { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 },
  draftGeneration: { temperature: 0.4, maxOutputTokens: 2_048, timeoutMs: 60_000 },
  feedbackClassification: { temperature: 0, maxOutputTokens: 4_096, timeoutMs: 60_000 },
}))
const loading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const saved = shallowRef(false)
const updatedAt = computed(() => data.value?.data.updatedAt ?? null)

/**
 * 保存四类完整系统 AI 参数，并同步页面中的更新时间和表单状态。
 * @param submittedValues 已通过共享 Schema 校验的完整设置。
 * @returns 保存与本地状态同步完成时结束。
 */
async function saveSettings(submittedValues: SystemAiSettingsValues): Promise<void> {
  loading.value = true
  actionError.value = null
  saved.value = false
  try {
    const response = await $fetch<ApiResponse<SystemAiSettingsView>>('/api/v1/system/ai-settings', {
      method: 'PUT',
      body: submittedValues,
    })
    Object.assign(values, systemAiSettingsValuesSchema.parse(response.data.values))
    data.value = response
    saved.value = true
  }
  catch (requestError: unknown) {
    actionError.value = getApiErrorMessage(requestError, '系统 AI 设置保存失败')
  }
  finally {
    loading.value = false
  }
}

/**
 * 把 Unix 毫秒时间转换为当前设备的中文日期时间。
 * @param timestamp UTC Unix 毫秒时间戳。
 * @returns 本地化后的中文日期时间文本。
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <ContentPageHeader title="系统 AI 设置" description="控制尚未迁移到固定算法的内部 AI 操作；灵魂和成长参数在 AI 算法页面维护。" />

    <div class="status-strip page-status-strip" aria-label="系统 AI 设置状态摘要">
      <div class="status-cell"><span class="status-kicker">配置范围</span><strong class="status-value">4 类操作</strong></div>
      <div class="status-cell"><span class="status-kicker">图文创作</span><strong class="status-value">仍用生成设置</strong></div>
      <div class="status-cell"><span class="status-kicker">提示词内容</span><strong class="status-value">提示词页维护</strong></div>
      <div class="status-cell"><span class="status-kicker">最近保存</span><strong class="status-value">{{ updatedAt ? formatTime(updatedAt) : '系统默认' }}</strong></div>
    </div>

    <div class="space-y-5 py-9">
      <UAlert
        color="neutral"
        variant="subtle"
        title="参数作用边界"
        description="这里控制兴趣判断、人物记忆、草稿生成和反馈分类；灵魂与成长参数由 AI 算法配置，提示词正文仍在提示词页维护。"
      />
      <UAlert v-if="error" color="error" title="系统 AI 设置加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
      <UAlert v-if="actionError" color="error" title="保存失败" :description="actionError" />
      <UAlert v-if="saved" color="success" title="系统 AI 设置已保存" description="后续新操作将使用当前参数。" />
      <SystemAiSettingsForm v-if="!error" :model-value="values" :loading="loading" @submit="saveSettings" />
    </div>
  </div>
</template>
