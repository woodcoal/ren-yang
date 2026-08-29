<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreateWorldInput } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { WorldDetails, WorldSummary } from '#shared/types/content'
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
 * 创建世界后进入详情页，由用户明确确认并使用初始修改稿。
 * @param input 已通过共享 Schema 校验的世界输入。
 * @returns 请求和导航结束时完成。
 */
async function createWorld(input: CreateWorldInput): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    const response = await $fetch<ApiResponse<WorldDetails>>('/api/v1/worlds', { method: 'POST', body: input })
    await navigateTo(`/worlds/${response.data.world.id}`)
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
      <UButton icon="i-lucide-plus" @click="showCreate = !showCreate">{{ showCreate ? '收起表单' : '创建世界' }}</UButton>
    </ContentPageHeader>

    <div class="status-strip page-status-strip" aria-label="世界状态摘要">
      <div class="status-cell"><span class="status-kicker">全部世界</span><strong class="status-value">{{ worlds.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">已发布</span><strong class="status-value">{{ activeWorldCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">关联人物</span><strong class="status-value">{{ linkedPersonaCount }}</strong></div>
      <div class="status-cell"><span class="status-kicker">参考资料</span><strong class="status-value">{{ sourceCount }}</strong></div>
    </div>

    <UCard v-if="showCreate" class="mt-6 mb-6">
      <template #header><h2 class="font-semibold text-highlighted">新世界设定</h2></template>
      <ContentWorldForm :loading="loading" :error-message="errorMessage" @submit="createWorld" />
    </UCard>

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
