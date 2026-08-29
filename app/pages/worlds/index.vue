<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { WorldDetails, WorldDraftView, WorldSummary } from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

const { data, error, refresh } = await useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds')
const worlds = computed(() => data.value?.data ?? [])
const activeWorldCount = computed(() => worlds.value.filter(world => world.activeVersionId).length)
const linkedPersonaCount = computed(() => worlds.value.reduce((total, world) => total + world.personaCount, 0))
const sourceCount = computed(() => worlds.value.reduce((total, world) => total + world.sourceCount, 0))
const showCreate = shallowRef(false)
const loading = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)

/**
 * 先把自然语言生成为世界草稿，再使用现有内容服务创建世界并进入详情。
 * @param prompt 用户在弹窗中确认的世界描述。
 * @returns 生成、创建和导航全部完成时结束。
 */
async function createWorld(prompt: string): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    const draft = await $fetch<ApiResponse<WorldDraftView>>('/api/v1/worlds/draft', { method: 'POST', body: { prompt } })
    const created = await $fetch<ApiResponse<WorldDetails>>('/api/v1/worlds', {
      method: 'POST',
      body: {
        name: draft.data.name,
        summary: draft.data.summary,
        snapshot: draft.data.snapshot,
        changeSummary: '根据自然语言生成初始世界灵魂草稿',
      },
    })
    await navigateTo(`/worlds/${created.data.world.id}`)
  }
  catch (requestError: unknown) {
    errorMessage.value = getApiErrorMessage(requestError, '世界设定创建失败')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <ContentPageHeader title="世界设定" description="世界是相关人物共用的背景与规则；人物也可以不关联世界，独立完成任务。">
      <UButton icon="i-lucide-plus" @click="showCreate = true">创建世界</UButton>
    </ContentPageHeader>

    <ContentQuickCreateSubjectModal
      v-model:open="showCreate"
      subject-type="world"
      :loading="loading"
      :error-message="errorMessage"
      @submit="createWorld"
    />

    <div class="status-strip page-status-strip" aria-label="世界状态摘要">
      <div class="status-cell"><span class="status-kicker">全部世界</span><strong class="status-value">{{ worlds.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">已发布</span><strong class="status-value">{{ activeWorldCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">关联人物</span><strong class="status-value">{{ linkedPersonaCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">参考资料</span><strong class="status-value">{{ sourceCount }}</strong></div>
    </div>

    <UAlert v-if="error" color="error" title="世界列表加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <section v-else-if="worlds.length" class="content-section" aria-labelledby="world-list-heading">
      <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">世界列表</p><h2 id="world-list-heading">已建立的世界设定</h2><p>已发布内容可被新任务使用，修改稿仍需人工确认。</p></div></div>
      <div class="content-table-wrap">
        <table class="content-table">
          <thead><tr><th>世界</th><th>使用关系</th><th>版本</th><th>当前状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="world in worlds" :key="world.id">
              <td data-label="世界"><strong class="content-table-title">{{ world.name }}</strong><span class="content-table-description">{{ world.summary || '未填写摘要' }}</span></td>
              <td data-label="使用关系"><span>{{ world.personaCount }} 个人物</span><span class="content-table-description">{{ world.sourceCount }} 项资料</span></td>
              <td data-label="版本"><span>{{ world.versionCount }} 条修改记录</span></td>
              <td data-label="当前状态"><UBadge :color="world.activeVersionId ? 'success' : 'warning'" variant="subtle">{{ world.activeVersionId ? '已发布，可使用' : '等待确认' }}</UBadge></td>
              <td data-label="操作"><UButton :to="`/worlds/${world.id}`" color="neutral" variant="link">查看与维护</UButton></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <div v-else class="content-empty-state"><div><strong>还没有世界设定</strong><p>独立人物仍可正常创建和执行任务。</p></div></div>
  </div>
</template>
