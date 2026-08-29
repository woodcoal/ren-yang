<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import type { FormSubmitEvent } from '@nuxt/ui'
import { createParameterProfileSchema, type CreateParameterProfileInput } from '#shared/schemas/generation'
import type { ApiResponse } from '#shared/types/api'
import type { ParameterProfileView } from '#shared/types/generation'
import { getApiErrorMessage } from '../utils/apiError'

const { data, error, refresh } = await useFetch<ApiResponse<ParameterProfileView[]>>('/api/v1/parameter-profiles')
const profiles = computed(() => data.value?.data ?? [])
const loading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const form = reactive<CreateParameterProfileInput>({
  name: '',
  values: {
    temperature: 0.4,
    maxOutputTokens: 2048,
    timeoutMs: 60000,
    maxEvidenceChunks: 8,
    maxTextBlocks: 12,
    maxImageBlocks: 4,
    maxPromptCharacters: 120000,
    maxTotalTokens: 50000,
    maxBlockAttempts: 2,
  },
})

/** @param event Nuxt UI 已通过共享 Schema 校验的提交事件。 @returns 创建新版本并刷新列表。 */
async function createProfile(event: FormSubmitEvent<CreateParameterProfileInput>): Promise<void> {
  loading.value = true
  actionError.value = null
  try {
    await $fetch('/api/v1/parameter-profiles', { method: 'POST', body: event.data })
    form.name = ''
    await refresh()
  }
  catch (requestError: unknown) {
    actionError.value = getApiErrorMessage(requestError, '参数方案创建失败')
  }
  finally {
    loading.value = false
  }
}

/** @param timestamp UTC Unix 毫秒。 @returns 本地日期时间。 */
function formatTime(timestamp: number): string { return new Date(timestamp).toLocaleString('zh-CN') }
</script>

<template>
  <div>
    <ContentPageHeader title="参数方案" description="每次保存创建同名下一版本；已被运行引用的参数快照不会变化。" />
    <div class="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
      <UCard>
        <template #header><h2 class="font-semibold text-highlighted">创建方案版本</h2></template>
        <UAlert v-if="actionError" class="mb-4" color="error" title="创建失败" :description="actionError" />
        <UForm :schema="createParameterProfileSchema" :state="form" class="space-y-4" @submit="createProfile">
          <UFormField name="name" label="方案名称" required><UInput v-model="form.name" class="w-full" /></UFormField>
          <UFormField name="values.temperature" label="温度 0–2" required><UInput v-model.number="form.values.temperature" type="number" min="0" max="2" step="0.1" class="w-full" /></UFormField>
          <UFormField name="values.maxOutputTokens" label="最大输出 Token" required><UInput v-model.number="form.values.maxOutputTokens" type="number" min="64" max="8192" class="w-full" /></UFormField>
          <UFormField name="values.timeoutMs" label="超时毫秒" required><UInput v-model.number="form.values.timeoutMs" type="number" min="1000" max="120000" step="1000" class="w-full" /></UFormField>
          <UFormField name="values.maxEvidenceChunks" label="最大证据块" required><UInput v-model.number="form.values.maxEvidenceChunks" type="number" min="0" max="50" class="w-full" /></UFormField>
          <UFormField name="values.maxTextBlocks" label="最大文字块" required><UInput v-model.number="form.values.maxTextBlocks" type="number" min="1" max="20" class="w-full" /></UFormField>
          <UFormField name="values.maxImageBlocks" label="最大图片块" required><UInput v-model.number="form.values.maxImageBlocks" type="number" min="0" max="20" class="w-full" /></UFormField>
          <UFormField name="values.maxPromptCharacters" label="单次提示最大字符" required><UInput v-model.number="form.values.maxPromptCharacters" type="number" min="1000" max="500000" class="w-full" /></UFormField>
          <UFormField name="values.maxTotalTokens" label="运行最大总 Token" required><UInput v-model.number="form.values.maxTotalTokens" type="number" min="64" max="1000000" class="w-full" /></UFormField>
          <UFormField name="values.maxBlockAttempts" label="单块最大尝试" required><UInput v-model.number="form.values.maxBlockAttempts" type="number" min="1" max="10" class="w-full" /></UFormField>
          <UButton type="submit" :loading="loading">创建不可变版本</UButton>
        </UForm>
      </UCard>

      <div>
        <UAlert v-if="error" color="error" title="参数方案加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
        <div v-else-if="profiles.length" class="space-y-3">
          <UCard v-for="profile in profiles" :key="profile.id">
            <template #header><div class="flex justify-between gap-3"><h2 class="font-medium text-highlighted">{{ profile.name }} v{{ profile.version }}</h2><UBadge color="neutral" variant="subtle">{{ profile.isActive ? '启用' : '停用' }}</UBadge></div></template>
            <dl class="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
              <div><dt class="text-muted">温度</dt><dd>{{ profile.values.temperature }}</dd></div>
              <div><dt class="text-muted">输出 Token</dt><dd>{{ profile.values.maxOutputTokens }}</dd></div>
              <div><dt class="text-muted">超时</dt><dd>{{ profile.values.timeoutMs }} ms</dd></div>
              <div><dt class="text-muted">证据块</dt><dd>{{ profile.values.maxEvidenceChunks }}</dd></div>
              <div><dt class="text-muted">文字块</dt><dd>{{ profile.values.maxTextBlocks }}</dd></div>
              <div><dt class="text-muted">图片块</dt><dd>{{ profile.values.maxImageBlocks }}</dd></div>
              <div><dt class="text-muted">提示字符</dt><dd>{{ profile.values.maxPromptCharacters }}</dd></div>
              <div><dt class="text-muted">总 Token</dt><dd>{{ profile.values.maxTotalTokens }}</dd></div>
              <div><dt class="text-muted">块尝试</dt><dd>{{ profile.values.maxBlockAttempts }}</dd></div>
              <div><dt class="text-muted">创建时间</dt><dd>{{ formatTime(profile.createdAt) }}</dd></div>
            </dl>
          </UCard>
        </div>
        <UCard v-else><p class="py-8 text-center text-sm text-muted">尚无参数方案，运行会使用系统默认参数。</p></UCard>
      </div>
    </div>
  </div>
</template>
