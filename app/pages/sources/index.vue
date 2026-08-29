<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreateSourceInput } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { SourceChunkView, SourceDetails, SourceSummary } from '#shared/types/content'
import type { SourceFileSubmission } from '../../components/content/SourceImportForm.vue'
import { getApiErrorMessage } from '../../utils/apiError'

const { data, error, refresh } = await useFetch<ApiResponse<SourceSummary[]>>('/api/v1/sources')
const sources = computed(() => data.value?.data ?? [])
const chunkCount = computed(() => sources.value.reduce((total, source) => total + source.chunkCount, 0))
const linkedSourceCount = computed(() => sources.value.filter(source => source.linkCount > 0).length)
const fileSourceCount = computed(() => sources.value.filter(source => source.inputType !== 'paste').length)
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
    <ContentPageHeader title="资料库" description="统一导入、检索和维护人物或世界会参考的事实、背景与风格资料。">
      <UButton icon="i-lucide-plus" @click="showImport = !showImport">{{ showImport ? '收起导入' : '导入资料' }}</UButton>
    </ContentPageHeader>
    <div class="status-strip page-status-strip" aria-label="资料状态摘要">
      <div class="status-cell"><span class="status-kicker">全部资料</span><strong class="status-value">{{ sources.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">可检索段落</span><strong class="status-value">{{ chunkCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">已建立关系</span><strong class="status-value">{{ linkedSourceCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">文件导入</span><strong class="status-value">{{ fileSourceCount }}</strong></div>
    </div>
    <ContentSourceImportForm v-if="showImport" class="mt-6 mb-7" :loading="loading" :error-message="errorMessage" @paste="createPastedSource" @file="importFile" />

    <section class="content-section" aria-labelledby="source-search-heading">
      <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">资料检索</p><h2 id="source-search-heading">查找资料中的事实与段落</h2><p>输入一句话或关键词，返回本地事实库中最相关的可追溯段落。</p></div></div>
      <form class="content-toolbar" @submit.prevent="searchSources">
        <UInput v-model="searchQuery" class="flex-1" placeholder="输入资料中的短语" aria-label="资料检索词" />
        <UButton type="submit" color="neutral" variant="soft" :loading="loading">检索</UButton>
      </form>
      <div v-if="searchResults" class="mt-4 space-y-3">
          <p v-if="searchResults.length === 0" class="text-sm text-muted">没有找到相关段落。</p>
        <div v-for="chunk in searchResults" :key="chunk.id" class="archive-panel">
          <p class="text-xs font-medium text-primary">{{ chunk.heading || '无标题' }} · 第 {{ chunk.ordinal + 1 }} 段</p>
          <p class="mt-1 whitespace-pre-wrap text-sm text-muted">{{ chunk.content }}</p>
          <UButton :to="`/sources/${chunk.sourceId}`" color="neutral" variant="link" size="sm" class="mt-1 px-0">查看资料</UButton>
        </div>
      </div>
    </section>

    <UAlert v-if="error" color="error" title="资料列表加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <section v-else-if="sources.length" class="content-section" aria-labelledby="source-list-heading">
      <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">处理与关系</p><h2 id="source-list-heading">资料内容、检索段落与使用范围</h2><p>资料正文保存在 SQLite；关联关系决定它会进入哪个世界或人物的上下文。</p></div></div>
      <div class="content-table-wrap">
        <table class="content-table">
          <thead><tr><th>资料</th><th>用途</th><th>检索内容</th><th>使用关系</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="source in sources" :key="source.id">
              <td data-label="资料"><strong class="content-table-title">{{ source.name }}</strong><span class="content-table-description">{{ source.contentText.slice(0, 120) }}{{ source.contentText.length > 120 ? '…' : '' }}</span></td>
              <td data-label="用途"><UBadge color="neutral" variant="subtle">{{ roleLabels[source.role] }}</UBadge><span class="content-table-description">{{ source.inputType === 'paste' ? '粘贴文本' : source.inputType.toUpperCase() + ' 文件' }}</span></td>
              <td data-label="检索内容">{{ source.chunkCount }} 个段落</td>
              <td data-label="使用关系">{{ source.linkCount }} 个对象</td>
              <td data-label="操作"><UButton :to="`/sources/${source.id}`" color="neutral" variant="link">查看与维护</UButton></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-else class="content-empty-state"><div><strong>还没有资料</strong><p>可以先创建原创人物，也可以从粘贴文本、TXT 或 Markdown 开始导入。</p></div></div>
  </div>
</template>
