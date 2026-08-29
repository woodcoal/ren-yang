<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreatePersonaInput, GeneratePersonaDraftInput } from '#shared/schemas/content'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaDetails, PersonaDraftView, SourceSummary, WorldSummary } from '#shared/types/content'
import type { TextModelCapability } from '#shared/types/generation'
import { getApiErrorMessage } from '../../utils/apiError'

/** 创建人物页使用的能力响应字段。 */
interface CapabilityResponse {
  textModel: TextModelCapability
}

const [{ data: worldData }, { data: sourceData }, { data: capabilityData }] = await Promise.all([
  useFetch<ApiResponse<WorldSummary[]>>('/api/v1/worlds'),
  useFetch<ApiResponse<SourceSummary[]>>('/api/v1/sources'),
  useFetch<ApiResponse<CapabilityResponse>>('/api/v1/system/capabilities'),
])
const worlds = computed(() => worldData.value?.data ?? [])
const sources = computed(() => sourceData.value?.data ?? [])
const textModelConfigured = computed(() => capabilityData.value?.data.textModel.configured ?? false)
const loading = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)
const draftLoading = shallowRef(false)
const draftErrorMessage = shallowRef<string | null>(null)
const generatedInitialValue = shallowRef<CreatePersonaInput | null>(null)
const draftWarnings = shallowRef<string[]>([])

/**
 * 调用文本模型生成不落库草稿，再把完整选择和结构化结果交给编辑表单。
 * @param input 自然语言、来源模式和参考上下文。
 * @returns 请求完成时结束。
 */
async function generateDraft(input: GeneratePersonaDraftInput): Promise<void> {
  draftLoading.value = true
  draftErrorMessage.value = null
  draftWarnings.value = []
  try {
    const response = await $fetch<ApiResponse<PersonaDraftView>>('/api/v1/personas/draft', { method: 'POST', body: input })
    generatedInitialValue.value = {
      name: response.data.name,
      origin: input.origin,
      worldId: input.worldId ?? null,
      sourceIds: [...input.sourceIds],
      snapshot: { ...response.data.snapshot },
      changeSummary: '根据自然语言生成初始候选档案',
    }
    draftWarnings.value = [...response.data.warnings]
  }
  catch (error: unknown) {
    draftErrorMessage.value = getApiErrorMessage(error, '人物草稿生成失败')
  }
  finally {
    draftLoading.value = false
  }
}

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
    <div class="space-y-6">
      <ContentPersonaDraftAssistant
        :worlds="worlds"
        :sources="sources"
        :text-model-configured="textModelConfigured"
        :loading="draftLoading"
        :error-message="draftErrorMessage"
        @generate="generateDraft"
      />
      <UAlert
        v-if="draftWarnings.length"
        color="warning"
        title="草稿已生成，但部分上下文被截断"
        :description="draftWarnings.join('；')"
      />
      <UCard>
        <template #header>
          <div>
            <h2 class="font-semibold text-highlighted">结构化候选档案</h2>
            <p class="mt-1 text-sm text-muted">逐项检查后保存；保存仍只是候选版本，需要另行发布。</p>
          </div>
        </template>
      <ContentPersonaForm
        :worlds="worlds"
        :sources="sources"
        :loading="loading"
        :error-message="errorMessage"
        :initial-value="generatedInitialValue"
        @submit="createPersona"
      />
      </UCard>
    </div>
  </div>
</template>
