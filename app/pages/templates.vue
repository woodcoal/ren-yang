<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import type { FormSubmitEvent } from '@nuxt/ui'
import { createFormatTemplateSchema, type CreateFormatTemplateInput } from '#shared/schemas/generation'
import type { ApiResponse } from '#shared/types/api'
import type { FormatTemplateView } from '#shared/types/generation'
import { getApiErrorMessage } from '../utils/apiError'

const { data, error, refresh } = await useFetch<ApiResponse<FormatTemplateView[]>>('/api/v1/format-templates')
const templates = computed(() => data.value?.data ?? [])
const activeTemplateCount = computed(() => templates.value.filter(template => template.isActive).length)
const latestTemplate = computed(() => templates.value[0] ?? null)
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
    <ContentPageHeader title="让内容格式保持可追溯" description="用版本化模板规定文章、报告或图文内容的结构；模板只约束输出格式，不改变人物性格。" />
    <div class="status-strip page-status-strip" aria-label="内容模板状态摘要">
      <div class="status-cell"><span class="status-kicker">全部版本</span><strong class="status-value">{{ templates.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">当前启用</span><strong class="status-value">{{ activeTemplateCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">最新模板</span><strong class="status-value">{{ latestTemplate?.name || '系统默认' }}</strong></div>
      <div class="status-cell"><span class="status-kicker">输出格式</span><strong class="status-value">HTML / Markdown / Txt</strong></div>
    </div>
    <div class="grid gap-6 py-9 xl:grid-cols-[26rem_minmax(0,1fr)]">
      <section class="archive-panel" aria-labelledby="template-create-heading">
        <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">新版本</p><h2 id="template-create-heading">新建内容格式</h2><p>同名再次保存会生成一条新记录，旧任务仍保留原来的格式。</p></div></div>
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
      </section>

      <section aria-labelledby="template-list-heading">
        <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">模板记录</p><h2 id="template-list-heading">按版本检查格式规则</h2><p>每个任务使用创建时锁定的模板版本。</p></div></div>
        <UAlert v-if="error" color="error" title="模板加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
        <div v-else-if="templates.length" class="log-list">
          <article v-for="template in templates" :key="template.id" class="log-row">
            <span class="log-row-meta">v{{ template.version }}<br>{{ formatTime(template.createdAt) }}</span>
            <span class="log-row-main"><strong class="log-row-title">{{ template.name }}</strong><span class="log-row-description">{{ template.spec.guidance }}</span><span class="log-row-description">{{ template.spec.minimumBlocks }}–{{ template.spec.maximumBlocks }} 个内容块</span></span>
            <span class="log-row-end"><UBadge color="neutral" variant="subtle">{{ template.isActive ? '当前启用' : '历史版本' }}</UBadge></span>
          </article>
        </div>
        <div v-else class="content-empty-state"><div><strong>还没有自定义内容格式</strong><p>创作时会使用系统默认纯文本结构。</p></div></div>
      </section>
    </div>
  </div>
</template>
