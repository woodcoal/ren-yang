<script setup lang="ts">
import { computed } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary } from '#shared/types/content'

const { data, error, refresh } = await useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas')
const personas = computed(() => data.value?.data ?? [])

/** 人物来源模式中文标签。 */
const originLabels: Record<PersonaSummary['origin'], string> = {
  original: '原创',
  source_based: '资料型',
  hybrid: '混合型',
}
</script>

<template>
  <div>
    <ContentPageHeader title="人物" description="人物元数据可编辑；档案通过候选、发布和回滚维护，不覆盖历史版本。">
      <UButton to="/personas/new" icon="i-lucide-plus">创建人物</UButton>
    </ContentPageHeader>

    <UAlert v-if="error" color="error" title="人物列表加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <div v-else-if="personas.length" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <UCard v-for="persona in personas" :key="persona.id">
        <template #header>
          <div class="flex items-start justify-between gap-3">
            <div>
              <h2 class="font-semibold text-highlighted">{{ persona.name }}</h2>
              <p class="mt-1 text-xs text-muted">{{ originLabels[persona.origin] }} · {{ persona.worldName || '独立人物' }}</p>
            </div>
            <UBadge :color="persona.activeVersionId ? 'success' : 'warning'" variant="subtle">
              {{ persona.activeVersionId ? '已发布' : '待发布' }}
            </UBadge>
          </div>
        </template>
        <p class="min-h-10 text-sm text-muted">{{ persona.currentSummary || '尚无已发布人物摘要' }}</p>
        <div class="mt-4 flex gap-4 text-xs text-muted">
          <span>{{ persona.versionCount }} 个版本</span>
          <span>{{ persona.sourceCount }} 项资料</span>
        </div>
        <template #footer>
          <UButton :to="`/personas/${persona.id}`" color="neutral" variant="soft" block>查看与维护</UButton>
        </template>
      </UCard>
    </div>
    <UCard v-else>
      <div class="py-8 text-center">
        <p class="font-medium text-highlighted">还没有人物</p>
        <p class="mt-1 text-sm text-muted">原创人物不需要先导入资料。</p>
        <UButton to="/personas/new" class="mt-4">创建第一个人物</UButton>
      </div>
    </UCard>
  </div>
</template>
