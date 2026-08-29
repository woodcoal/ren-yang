<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import type { FormSubmitEvent } from '@nuxt/ui'
import { createFormatTemplateSchema, type CreateFormatTemplateInput } from '#shared/schemas/generation'
import type { ApiResponse } from '#shared/types/api'
import type { FormatTemplateView } from '#shared/types/generation'
import { getApiErrorMessage } from '../utils/apiError'

const { data, error, refresh } = await useFetch<ApiResponse<FormatTemplateView[]>>('/api/v1/format-templates')
const templates = computed(() => data.value?.data ?? [])
const loading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const form = reactive<CreateFormatTemplateInput>({
  name: '',
  spec: { guidance: '', minimumBlocks: 1, maximumBlocks: 8 },
})

/** @param event Nuxt UI 已通过共享 Schema 校验的提交事件。 @returns 创建模板新版本并刷新列表。 */
async function createTemplate(event: FormSubmitEvent<CreateFormatTemplateInput>): Promise<void> {
  loading.value = true
  actionError.value = null
  try {
    await $fetch('/api/v1/format-templates', { method: 'POST', body: event.data })
    form.name = ''
    form.spec.guidance = ''
    await refresh()
  }
  catch (requestError: unknown) {
    actionError.value = getApiErrorMessage(requestError, '内容格式创建失败')
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
    <ContentPageHeader title="内容格式" description="规定生成内容的结构和段落数量，例如文章、报告或图文卡片；不会改变人物性格。" />
    <div class="grid gap-6 xl:grid-cols-[26rem_minmax(0,1fr)]">
      <UCard>
        <template #header><div><h2 class="font-semibold text-highlighted">新建内容格式</h2><p class="mt-1 text-sm text-muted">同名再次保存会生成一条新记录，旧任务仍保留原来的格式。</p></div></template>
        <UAlert v-if="actionError" class="mb-4" color="error" title="创建失败" :description="actionError" />
        <UForm :schema="createFormatTemplateSchema" :state="form" class="space-y-4" @submit="createTemplate">
          <UFormField name="name" label="模板名称" required><UInput v-model="form.name" class="w-full" /></UFormField>
          <UFormField name="spec.guidance" label="希望内容怎样组织" description="例如：先给结论，再分三段说明，每段带一个小标题。" required><UTextarea v-model="form.spec.guidance" :rows="7" class="w-full" /></UFormField>
          <div class="grid grid-cols-2 gap-4">
            <UFormField name="spec.minimumBlocks" label="最少内容块" required><UInput v-model.number="form.spec.minimumBlocks" type="number" min="1" max="20" class="w-full" /></UFormField>
            <UFormField name="spec.maximumBlocks" label="最多内容块" required><UInput v-model.number="form.spec.maximumBlocks" type="number" min="1" max="20" class="w-full" /></UFormField>
          </div>
          <UButton type="submit" :loading="loading">保存内容格式</UButton>
        </UForm>
      </UCard>

      <div>
        <UAlert v-if="error" color="error" title="模板加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
        <div v-else-if="templates.length" class="space-y-3">
          <UCard v-for="template in templates" :key="template.id">
            <template #header><div class="flex justify-between gap-3"><h2 class="font-medium text-highlighted">{{ template.name }} v{{ template.version }}</h2><UBadge color="neutral" variant="subtle">{{ template.isActive ? '启用' : '停用' }}</UBadge></div></template>
            <pre class="content-pre">{{ template.spec.guidance }}</pre>
            <p class="mt-3 text-xs text-muted">{{ template.spec.minimumBlocks }}–{{ template.spec.maximumBlocks }} 个内容块 · {{ formatTime(template.createdAt) }}</p>
          </UCard>
        </div>
        <UCard v-else><p class="py-8 text-center text-sm text-muted">还没有自定义内容格式，创作时会使用默认纯文本结构。</p></UCard>
      </div>
    </div>
  </div>
</template>
