<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreatePersonaInput } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaDetails, SourceSummary, WorldSummary } from '#shared/types/content'
import { getApiErrorMessage } from '../../utils/apiError'

const [{ data: worldData }, { data: sourceData }] = await Promise.all([
  useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds'),
  useFetch<ApiResponse<SourceSummary[]>>('/api/v1/sources'),
])
const worlds = computed(() => worldData.value?.data ?? [])
const sources = computed(() => sourceData.value?.data ?? [])
const loading = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)

/**
 * 创建人物后进入详情页，由用户决定是否发布初始候选版本。
 * @param input 已通过共享 Schema 校验的人物输入。
 * @returns 请求和导航结束时完成。
 */
async function createPersona(input: CreatePersonaInput): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    const response = await $fetch<ApiResponse<PersonaDetails>>('/api/v1/personas', { method: 'POST', body: input })
    await navigateTo(`/personas/${response.data.persona.id}`)
  }
  catch (error: unknown) {
    errorMessage.value = getApiErrorMessage(error, '人物创建失败')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <ContentPageHeader title="创建人物" description="资料和世界均可选；资料型人物必须选择至少一项资料。" />
    <UCard>
      <ContentPersonaForm
        :worlds="worlds"
        :sources="sources"
        :loading="loading"
        :error-message="errorMessage"
        @submit="createPersona"
      />
    </UCard>
  </div>
</template>
