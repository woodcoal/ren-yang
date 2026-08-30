<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { SourceSearchResultView } from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

const route = useRoute()

/**
 * 从路由参数读取唯一的段落搜索词。
 * @param value URL 查询参数原值。
 * @returns 去除首尾空白后的搜索词。
 */
function readSearchQuery(value: unknown): string {
  const normalized = Array.isArray(value) ? value[0] : value
  return typeof normalized === 'string' ? normalized.trim() : ''
}

const currentQuery = computed(() => readSearchQuery(route.query.query))
const searchInput = shallowRef(currentQuery.value)
const { data, error, status, refresh } = await useAsyncData(
  'source-chunk-search-results',
  async () => {
    if (!currentQuery.value) return { data: [] } satisfies ApiResponse<SourceSearchResultView[]>
    return await $fetch<ApiResponse<SourceSearchResultView[]>>('/api/v1/sources/search', {
      query: { query: currentQuery.value, limit: 50 },
    })
  },
  { watch: [currentQuery] },
)
const results = computed(() => data.value?.data ?? [])

/**
 * 浏览器前进或后退改变搜索词时同步输入框。
 * @param query URL 中当前段落搜索词。
 * @returns 输入框同步完成时结束。
 */
function synchronizeSearchInput(query: string): void {
  searchInput.value = query
}

watch(currentQuery, synchronizeSearchInput)

/**
 * 提交新的段落搜索词并保留独立结果页。
 * @returns 搜索词有效时在路由更新后结束，否则直接结束。
 */
async function submitSearch(): Promise<void> {
  const query = searchInput.value.trim()
  if (!query) return
  await navigateTo({ path: '/sources/search', query: { query } })
}
</script>

<template>
  <div>
    <ContentPageHeader title="资料段落搜索" description="搜索资料正文拆分后的内容段落，不是筛选资料库项目。">
      <UButton to="/sources" color="neutral" variant="ghost">返回资料库</UButton>
    </ContentPageHeader>

    <section class="content-section" aria-labelledby="source-result-heading">
      <form class="content-toolbar" @submit.prevent="submitSearch">
        <UInput v-model="searchInput" class="flex-1" icon="i-lucide-search" placeholder="输入资料中的短语" aria-label="段落搜索词" />
        <UButton type="submit" :loading="status === 'pending'">搜索段落</UButton>
      </form>

      <UAlert
        v-if="error"
        class="mt-5"
        color="error"
        title="段落搜索失败"
        :description="getApiErrorMessage(error, '资料段落搜索请求失败')"
        :actions="[{ label: '重试', onClick: () => refresh() }]"
      />

      <template v-else-if="currentQuery">
        <div class="section-heading mt-6">
          <div class="section-heading-copy">
            <p class="eyebrow">段落结果</p>
            <h2 id="source-result-heading">“{{ currentQuery }}”找到 {{ results.length }} 个段落</h2>
            <p>结果按 FTS5 相关性排序；高亮仅标记当前关键词的字面命中位置。</p>
          </div>
        </div>

        <div v-if="results.length" class="space-y-4">
          <article v-for="result in results" :key="result.id" class="archive-panel">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <NuxtLink :to="`/sources/${result.sourceId}`" class="font-semibold text-primary hover:underline">
                {{ result.sourceName }}
              </NuxtLink>
              <UBadge color="neutral" variant="subtle">第 {{ result.ordinal + 1 }} 段</UBadge>
            </div>
            <h3 v-if="result.heading" class="mt-3 text-sm font-medium text-highlighted">
              <ContentHighlightedText :text="result.heading" :query="currentQuery" />
            </h3>
            <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">
              <ContentHighlightedText :text="result.content" :query="currentQuery" />
            </p>
            <UButton :to="`/sources/${result.sourceId}`" color="neutral" variant="link" size="sm" class="mt-2 px-0">查看所属资料</UButton>
          </article>
        </div>
        <div v-else-if="status !== 'pending'" class="content-empty-state">
          <div><strong>没有找到相关段落</strong><p>请缩短关键词或改用资料正文中出现的短语。</p></div>
        </div>
      </template>

      <div v-else class="content-empty-state">
        <div><strong>输入关键词开始搜索</strong><p>这里仅搜索已启用资料的可检索段落。</p></div>
      </div>
    </section>
  </div>
</template>
