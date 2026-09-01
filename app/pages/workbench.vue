<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreateGenerationRunInput, CreateInterestBatchInput } from '#shared/schemas/generation'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary } from '#shared/types/content'
import type { CreatedInterestBatch, CreatedRun, ImageModelCapability, TextModelCapability } from '#shared/types/generation'
import { getApiErrorMessage } from '../utils/apiError'

/** 系统能力接口中创作工作台需要的字段。 */
interface CapabilityResponse {
  textModel: TextModelCapability
  imageModel: ImageModelCapability
  algorithmCapabilities: {
    articleGeneration: boolean
    articleImageGeneration: boolean
    interestAssessment: boolean
  }
  openViking: { configured: boolean, enabled: boolean }
  contextProvider: 'sqlite_fts5' | 'openviking'
}

const [{ data: personaData }, { data: capabilityData }] = await Promise.all([
  useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas'),
  useFetch<ApiResponse<CapabilityResponse>>('/api/v1/system/capabilities'),
])
const { runWithAiLoading } = useAiLoading()
const { notifySuccess, notifyError } = useOperationNotifications()
const personas = computed(() => (personaData.value?.data ?? []).filter(persona => persona.isEnabled))
const textCapability = computed(() => capabilityData.value?.data.textModel ?? null)
const imageCapability = computed(() => capabilityData.value?.data.imageModel ?? null)
const algorithmCapabilities = computed(() => capabilityData.value?.data.algorithmCapabilities ?? {
  articleGeneration: false,
  articleImageGeneration: false,
  interestAssessment: false,
})
const task = shallowRef<'generation' | 'interest'>('generation')
const loading = shallowRef(false)

/**
 * 创建一次直接生成文章的异步运行并进入详情页。
 * @param input 已由表单完成基础校验的完整生成条件。
 * @returns 创建和页面跳转完成时结束。
 */
async function submitGeneration(input: CreateGenerationRunInput): Promise<void> {
  await createRun('AI 正在创建文章', '系统正在锁定人物版本和创作条件，随后直接生成最终文章。', async () => {
    return await $fetch<ApiResponse<CreatedRun>>('/api/v1/generation-runs', { method: 'POST', body: input })
  })
}

/**
 * 创建一次批量兴趣判定，并按条目数量进入单项详情或筛选后的历史列表。
 * @param input 同一人物、顺序文本和可选整批附加提示词。
 * @returns 批次创建、通知和页面跳转完成时结束。
 */
async function submitInterest(input: CreateInterestBatchInput): Promise<void> {
  if (loading.value) return
  loading.value = true
  try {
    const response = await runWithAiLoading({
      title: 'AI 正在准备批量兴趣判断',
      description: '系统正在锁定人物版本、附加要求和参考资料，并建立一次批量模型任务。',
      completionHint: '同一人物的全部文本会一次提交，结果按输入顺序独立保存。',
    }, async () => await $fetch<ApiResponse<CreatedInterestBatch>>('/api/v1/interest-batches', {
      method: 'POST', body: input,
    }))
    notifySuccess(`已创建 ${response.data.items.length} 条兴趣判断。`, '批量任务创建完成')
    await navigateTo(`/interest-batches/${response.data.batchId}`)
  }
  catch (error: unknown) {
    notifyError(getApiErrorMessage(error, '创建批量兴趣判断失败'), '无法创建批量任务')
  }
  finally {
    loading.value = false
  }
}

/**
 * 统一处理工作台运行创建、通知和详情页跳转。
 * @param title AI 等待提示标题。
 * @param description AI 等待提示说明。
 * @param request 实际创建运行的请求函数。
 * @returns 请求成功或失败处理完成时结束。
 */
async function createRun(title: string, description: string, request: () => Promise<ApiResponse<CreatedRun>>): Promise<void> {
  if (loading.value) return
  loading.value = true
  try {
    const response = await runWithAiLoading({
      title,
      description,
      completionHint: '任务建立后将自动进入详情页，生成进度会持续更新。',
    }, request)
    notifySuccess('任务已建立，正在进入运行详情。', '运行创建完成')
    await navigateTo(`/runs/${response.data.runId}`)
  }
  catch (error: unknown) {
    notifyError(getApiErrorMessage(error, '创建运行失败'), '无法创建运行')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <ContentPageHeader title="创作工作台" description="选择人物并说明要求，系统直接生成符合人物个性的最终内容。">
      <UButton to="/history" color="neutral" variant="ghost">运行历史</UButton>
    </ContentPageHeader>

    <UAlert v-if="!textCapability?.configured" class="mb-5" color="warning" title="文本算法未配置" description="请在 AI 管理中配置接口、模型和对应固定算法。" />

    <div class="mb-6 grid gap-3 sm:grid-cols-2">
      <button class="workflow-panel text-left" :aria-pressed="task === 'generation'" @click="task = 'generation'">
        <p class="eyebrow">文章创作</p>
        <h2 class="mt-1 font-semibold text-highlighted">直接生成文章和配图</h2>
        <p class="mt-2 text-sm text-muted">输入条件后直接得到最终结果，不经过大纲或规格确认。</p>
      </button>
      <button class="workflow-panel text-left" :aria-pressed="task === 'interest'" @click="task = 'interest'">
        <p class="eyebrow">人物判断</p>
        <h2 class="mt-1 font-semibold text-highlighted">批量判断人物是否感兴趣</h2>
        <p class="mt-2 text-sm text-muted">一次提交一条或多条文本，可选添加整批附加提示词。</p>
      </button>
    </div>

    <GenerationArtifactGenerationForm
      v-if="task === 'generation'"
      :personas="personas"
      :image-configured="algorithmCapabilities.articleImageGeneration && Boolean(imageCapability?.configured)"
      :generation-configured="algorithmCapabilities.articleGeneration"
      :loading="loading"
      @submit="submitGeneration"
    />

    <GenerationInterestBatchForm
      v-else
      :personas="personas"
      :configured="algorithmCapabilities.interestAssessment"
      :loading="loading"
      @submit="submitInterest"
    />
  </div>
</template>
