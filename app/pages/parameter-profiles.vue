<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import type { FormSubmitEvent } from '@nuxt/ui'
import { createParameterProfileSchema, type CreateParameterProfileInput } from '#shared/schemas/generation'
import type { ApiResponse } from '#shared/types/api'
import type { ParameterProfileView } from '#shared/types/generation'
import { getApiErrorMessage } from '../utils/apiError'

const { data, error, refresh } = await useFetch<ApiResponse<ParameterProfileView[]>>('/api/v1/parameter-profiles')
const profiles = computed(() => data.value?.data ?? [])
const activeProfileCount = computed(() => profiles.value.filter(profile => profile.isActive).length)
const latestProfile = computed(() => profiles.value[0] ?? null)
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
    contextWindowTokens: 32768,
    reservedOutputTokens: 4096,
    safetyMarginTokens: 2048,
    worldBudgetTokens: 5000,
    worldSoulBudgetTokens: 2500,
    worldGrowthBudgetTokens: 2500,
    personaBudgetTokens: 9000,
    personaSoulBudgetTokens: 3500,
    personaGrowthBudgetTokens: 2500,
    personaMemoryBudgetTokens: 3000,
    sourceBudgetTokens: 5000,
  },
})
const availableInputTokens = computed(() => form.values.contextWindowTokens - form.values.reservedOutputTokens - form.values.safetyMarginTokens)

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
    actionError.value = getApiErrorMessage(requestError, '生成设置创建失败')
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
    <ContentPageHeader title="把生成规则写成可追溯的版本" description="控制 AI 输出、等待时间和各类上下文长度；每个任务会锁定创建时使用的设置版本。" />
    <div class="status-strip page-status-strip" aria-label="生成设置状态摘要">
      <div class="status-cell"><span class="status-kicker">全部版本</span><strong class="status-value">{{ profiles.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">当前启用</span><strong class="status-value">{{ activeProfileCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">最新方案</span><strong class="status-value">{{ latestProfile?.name || '系统默认' }}</strong></div>
      <div class="status-cell"><span class="status-kicker">可用输入</span><strong class="status-value">{{ availableInputTokens }} Token</strong></div>
    </div>
    <div class="grid gap-6 py-9 2xl:grid-cols-[32rem_minmax(0,1fr)]">
      <section class="archive-panel" aria-labelledby="profile-create-heading">
        <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">新版本</p><h2 id="profile-create-heading">新建生成设置</h2><p>同名再次保存会生成新记录，已经创建的任务不会随之变化。</p></div></div>
        <UAlert v-if="actionError" class="mb-4" color="error" title="创建失败" :description="actionError" />
        <UForm :schema="createParameterProfileSchema" :state="form" class="space-y-4" @submit="createProfile">
          <UFormField name="name" label="方案名称" required><UInput v-model="form.name" class="w-full" /></UFormField>
          <UFormField name="values.temperature" label="内容随机程度（0–2）" description="数值越低越稳定，越高越有变化。" required><UInput v-model.number="form.values.temperature" type="number" min="0" max="2" step="0.1" class="w-full" /></UFormField>
          <UFormField name="values.maxOutputTokens" label="单次回答长度上限" required><UInput v-model.number="form.values.maxOutputTokens" type="number" min="64" max="8192" class="w-full" /></UFormField>
          <UFormField name="values.timeoutMs" label="最长等待时间（毫秒）" required><UInput v-model.number="form.values.timeoutMs" type="number" min="1000" max="120000" step="1000" class="w-full" /></UFormField>
          <UFormField name="values.maxEvidenceChunks" label="最多参考资料段落" required><UInput v-model.number="form.values.maxEvidenceChunks" type="number" min="0" max="50" class="w-full" /></UFormField>
          <UFormField name="values.maxTextBlocks" label="最多文字内容块" required><UInput v-model.number="form.values.maxTextBlocks" type="number" min="1" max="20" class="w-full" /></UFormField>
          <UFormField name="values.maxImageBlocks" label="最多图片内容块" required><UInput v-model.number="form.values.maxImageBlocks" type="number" min="0" max="20" class="w-full" /></UFormField>
          <UFormField name="values.maxPromptCharacters" label="单次发送内容的字符上限" required><UInput v-model.number="form.values.maxPromptCharacters" type="number" min="1000" max="500000" class="w-full" /></UFormField>
          <UFormField name="values.maxTotalTokens" label="整个任务的模型用量上限" required><UInput v-model.number="form.values.maxTotalTokens" type="number" min="64" max="1000000" class="w-full" /></UFormField>
          <UFormField name="values.maxBlockAttempts" label="单个内容块最多尝试次数" required><UInput v-model.number="form.values.maxBlockAttempts" type="number" min="1" max="10" class="w-full" /></UFormField>
          <div class="border-t border-default pt-4">
            <h3 class="font-medium text-highlighted">提示词长度</h3>
            <p class="mt-1 text-sm text-muted">模型总长度扣除回答预留和安全余量后，本方案可使用 {{ availableInputTokens }} Token。</p>
          </div>
          <div class="grid gap-4 sm:grid-cols-3">
            <UFormField name="values.contextWindowTokens" label="模型总长度" required><UInput v-model.number="form.values.contextWindowTokens" type="number" min="4096" max="2000000" class="w-full" /></UFormField>
            <UFormField name="values.reservedOutputTokens" label="回答预留" required><UInput v-model.number="form.values.reservedOutputTokens" type="number" min="64" max="200000" class="w-full" /></UFormField>
            <UFormField name="values.safetyMarginTokens" label="安全余量" required><UInput v-model.number="form.values.safetyMarginTokens" type="number" min="0" max="200000" class="w-full" /></UFormField>
          </div>
          <div class="grid gap-4 sm:grid-cols-3">
            <UFormField name="values.worldBudgetTokens" label="世界总长度" required><UInput v-model.number="form.values.worldBudgetTokens" type="number" min="0" class="w-full" /></UFormField>
            <UFormField name="values.worldSoulBudgetTokens" label="世界灵魂" required><UInput v-model.number="form.values.worldSoulBudgetTokens" type="number" min="0" class="w-full" /></UFormField>
            <UFormField name="values.worldGrowthBudgetTokens" label="世界成长" required><UInput v-model.number="form.values.worldGrowthBudgetTokens" type="number" min="0" class="w-full" /></UFormField>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField name="values.personaBudgetTokens" label="人物总长度" required><UInput v-model.number="form.values.personaBudgetTokens" type="number" min="0" class="w-full" /></UFormField>
            <UFormField name="values.personaSoulBudgetTokens" label="人物灵魂" required><UInput v-model.number="form.values.personaSoulBudgetTokens" type="number" min="1" class="w-full" /></UFormField>
            <UFormField name="values.personaGrowthBudgetTokens" label="人物成长" required><UInput v-model.number="form.values.personaGrowthBudgetTokens" type="number" min="0" class="w-full" /></UFormField>
            <UFormField name="values.personaMemoryBudgetTokens" label="人物记忆" required><UInput v-model.number="form.values.personaMemoryBudgetTokens" type="number" min="0" class="w-full" /></UFormField>
          </div>
          <UFormField name="values.sourceBudgetTokens" label="参考资料总长度" description="达到上限后会整段跳过低优先级资料，不会截断半段正文。" required><UInput v-model.number="form.values.sourceBudgetTokens" type="number" min="0" class="w-full" /></UFormField>
          <UButton type="submit" :loading="loading">保存生成设置</UButton>
        </UForm>
      </section>

      <section aria-labelledby="profile-list-heading">
        <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">版本记录</p><h2 id="profile-list-heading">当前设置与历史版本</h2><p>修改设置不会追溯改写已经创建的任务。</p></div></div>
        <UAlert v-if="error" color="error" title="生成设置加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
        <div v-else-if="profiles.length" class="log-list">
          <article v-for="profile in profiles" :key="profile.id" class="log-row profile-log-row">
            <span class="log-row-meta">v{{ profile.version }}<br>{{ formatTime(profile.createdAt) }}</span>
            <div class="log-row-main"><strong class="log-row-title">{{ profile.name }}</strong>
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
              <div><dt class="text-muted">可用输入</dt><dd>{{ profile.values.contextWindowTokens - profile.values.reservedOutputTokens - profile.values.safetyMarginTokens }} Token</dd></div>
              <div><dt class="text-muted">世界 / 人物 / 资料</dt><dd>{{ profile.values.worldBudgetTokens }} / {{ profile.values.personaBudgetTokens }} / {{ profile.values.sourceBudgetTokens }}</dd></div>
            </dl>
            </div>
            <div class="log-row-end"><UBadge color="neutral" variant="subtle">{{ profile.isActive ? '当前启用' : '历史版本' }}</UBadge></div>
          </article>
        </div>
        <div v-else class="content-empty-state"><div><strong>还没有自定义生成设置</strong><p>任务会使用系统默认值。</p></div></div>
      </section>
    </div>
  </div>
</template>
