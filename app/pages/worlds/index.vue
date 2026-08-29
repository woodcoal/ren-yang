<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreateWorldInput } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { WorldDetails, WorldSummary } from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

const { data, error, refresh } = await useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds')
const worlds = computed(() => data.value?.data ?? [])
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
    <ContentPageHeader title="世界设定" description="世界是多个相关人物共用的背景；人物也可以不关联任何世界。">
      <UButton icon="i-lucide-plus" @click="showCreate = !showCreate">{{ showCreate ? '收起表单' : '创建世界' }}</UButton>
    </ContentPageHeader>

    <UCard v-if="showCreate" class="mb-6">
      <template #header><h2 class="font-semibold text-highlighted">新世界设定</h2></template>
      <ContentWorldForm :loading="loading" :error-message="errorMessage" @submit="createWorld" />
    </UCard>

    <UAlert v-if="error" color="error" title="世界列表加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <div v-else-if="worlds.length" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <UCard v-for="world in worlds" :key="world.id">
        <template #header>
          <div class="flex items-start justify-between gap-3">
            <h2 class="font-semibold text-highlighted">{{ world.name }}</h2>
            <UBadge :color="world.activeVersionId ? 'success' : 'warning'" variant="subtle">{{ world.activeVersionId ? '正在使用' : '待确认' }}</UBadge>
          </div>
        </template>
        <p class="min-h-10 text-sm text-muted">{{ world.summary || '未填写摘要' }}</p>
        <div class="mt-4 flex gap-4 text-xs text-muted">
          <span>{{ world.personaCount }} 个人物</span><span>{{ world.versionCount }} 条修改记录</span><span>{{ world.sourceCount }} 项资料</span>
        </div>
        <template #footer><UButton :to="`/worlds/${world.id}`" color="neutral" variant="soft" block>查看与维护</UButton></template>
      </UCard>
    </div>
    <UCard v-else><p class="py-8 text-center text-sm text-muted">尚无世界设定。独立人物仍可正常创建。</p></UCard>
  </div>
</template>
