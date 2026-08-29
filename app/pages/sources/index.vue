<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreateSourceInput } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { SourceChunkView, SourceDetails, SourceSummary } from '#shared/types/content'
import type { SourceFileSubmission } from '../../components/content/SourceImportForm.vue'
import { getApiErrorMessage } from '../../utils/apiError'

const { data, error, refresh } = await useFetch<ApiResponse<SourceSummary[]>>('/api/v1/sources')
const sources = computed(() => data.value?.data ?? [])
const showImport = shallowRef(false)
const loading = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)
const searchQuery = shallowRef('')
const searchResults = shallowRef<SourceChunkView[] | null>(null)

/** 资料角色中文标签。 */
const roleLabels: Record<SourceSummary['role'], string> = {
  canon_fact: '原作中的确定事实',
  reference: '背景参考',
  style_sample: '写作风格参考',
}

/** @param input 已校验粘贴文本。 @returns 创建与刷新结束时完成。 */
async function createPastedSource(input: CreateSourceInput): Promise<void> {
  await runImport(async () => {
    await $fetch<ApiResponse<SourceDetails>>('/api/v1/sources', { method: 'POST', body: input })
  })
}

/** @param input 文件元数据和浏览器 File。 @returns 上传与刷新结束时完成。 */
async function importFile(input: SourceFileSubmission): Promise<void> {
  await runImport(async () => {
    const body = new FormData()
    body.set('name', input.name)
    body.set('role', input.role)
    body.set('file', input.file)
    await $fetch<ApiResponse<SourceDetails>>('/api/v1/sources/files', { method: 'POST', body })
  })
}

/** @returns FTS5 查询完成时结束。 */
async function searchSources(): Promise<void> {
  if (!searchQuery.value.trim()) return
  loading.value = true
  errorMessage.value = null
  try {
    const response = await $fetch<ApiResponse<SourceChunkView[]>>('/api/v1/sources/search', {
      query: { query: searchQuery.value, limit: 20 },
    })
    searchResults.value = response.data
  }
  catch (requestError: unknown) {
    errorMessage.value = getApiErrorMessage(requestError, '资料检索失败')
  }
  finally {
    loading.value = false
  }
}

/** @param action 单次创建或上传动作。 @returns 动作与列表刷新结束时完成。 */
async function runImport(action: () => Promise<void>): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    await action()
    showImport.value = false
    await refresh()
  }
  catch (requestError: unknown) {
    errorMessage.value = getApiErrorMessage(requestError, '资料导入失败')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <ContentPageHeader title="资料库" description="集中保存人物和世界会参考的内容；同一份资料可以重复用于多个人物或世界。">
      <UButton icon="i-lucide-plus" @click="showImport = !showImport">{{ showImport ? '收起导入' : '导入资料' }}</UButton>
    </ContentPageHeader>
    <ContentSourceImportForm v-if="showImport" class="mb-7" :loading="loading" :error-message="errorMessage" @paste="createPastedSource" @file="importFile" />

    <UCard class="mb-6">
      <template #header><div><h2 class="font-semibold text-highlighted">搜索资料内容</h2><p class="mt-1 text-sm text-muted">输入一句话或关键词，查找资料中相关的段落。</p></div></template>
      <form class="flex gap-2" @submit.prevent="searchSources">
        <UInput v-model="searchQuery" class="flex-1" placeholder="输入资料中的短语" aria-label="资料检索词" />
        <UButton type="submit" color="neutral" variant="soft" :loading="loading">检索</UButton>
      </form>
      <div v-if="searchResults" class="mt-4 space-y-3">
          <p v-if="searchResults.length === 0" class="text-sm text-muted">没有找到相关段落。</p>
        <div v-for="chunk in searchResults" :key="chunk.id" class="rounded-md border border-default p-3">
          <p class="text-xs font-medium text-primary">{{ chunk.heading || '无标题' }} · 第 {{ chunk.ordinal + 1 }} 段</p>
          <p class="mt-1 whitespace-pre-wrap text-sm text-muted">{{ chunk.content }}</p>
          <UButton :to="`/sources/${chunk.sourceId}`" color="neutral" variant="link" size="sm" class="mt-1 px-0">查看资料</UButton>
        </div>
      </div>
    </UCard>

    <UAlert v-if="error" color="error" title="资料列表加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <div v-else-if="sources.length" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <UCard v-for="source in sources" :key="source.id">
        <template #header><div class="flex justify-between gap-3"><h2 class="font-semibold text-highlighted">{{ source.name }}</h2><UBadge color="neutral" variant="subtle">{{ roleLabels[source.role] }}</UBadge></div></template>
        <p class="line-clamp-3 text-sm text-muted">{{ source.contentText }}</p>
        <div class="mt-4 flex gap-4 text-xs text-muted"><span>{{ source.chunkCount }} 个内容段落</span><span>用于 {{ source.linkCount }} 个对象</span></div>
        <template #footer><UButton :to="`/sources/${source.id}`" color="neutral" variant="soft" block>查看与维护</UButton></template>
      </UCard>
    </div>
    <UCard v-else><p class="py-8 text-center text-sm text-muted">尚无资料。原创人物仍可正常创建。</p></UCard>
  </div>
</template>
