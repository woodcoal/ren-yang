<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import type { CreateGenerationRunInput } from '#shared/schemas/generation'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary } from '#shared/types/content'
import type { CreatedRun, ImageModelCapability, TextModelCapability } from '#shared/types/generation'
import { getApiErrorMessage } from '../utils/apiError'

/** 系统能力接口中创作工作台需要的字段。 */
interface CapabilityResponse {
  textModel: TextModelCapability
  imageModel: ImageModelCapability
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
const task = shallowRef<'generation' | 'interest'>('generation')
const loading = shallowRef(false)
const interestForm = reactive({
  personaId: '',
  content: '',
  scene: { ageStage: '', location: '', currentGoal: '', emotion: '', event: '' },
})

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

/** @returns 创建一次兴趣判断运行并进入详情页。 */
async function submitInterest(): Promise<void> {
  if (!interestForm.personaId || !interestForm.content.trim()) {
    notifyError('必须选择人物并填写待判断内容', '无法创建运行')
    return
  }
  await createRun('AI 正在准备人物判断', '系统正在锁定人物版本、场景与参考资料，并创建判断任务。', async () => {
    return await $fetch<ApiResponse<CreatedRun>>('/api/v1/interest-runs', {
      method: 'POST',
      body: {
        personaId: interestForm.personaId,
        content: interestForm.content.trim(),
        scene: { ...interestForm.scene },
      },
    })
  })
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

    <UAlert v-if="!textCapability?.configured" class="mb-5" color="warning" title="文本模型未配置" description="请通过环境变量配置 OpenAI-compatible 接口后重启服务；密钥不会进入数据库。" />

    <div class="mb-6 grid gap-3 sm:grid-cols-2">
      <button class="workflow-panel text-left" :aria-pressed="task === 'generation'" @click="task = 'generation'">
        <p class="eyebrow">文章创作</p>
        <h2 class="mt-1 font-semibold text-highlighted">直接生成文章和配图</h2>
        <p class="mt-2 text-sm text-muted">输入条件后直接得到最终结果，不经过大纲或规格确认。</p>
      </button>
      <button class="workflow-panel text-left" :aria-pressed="task === 'interest'" @click="task = 'interest'">
        <p class="eyebrow">人物判断</p>
        <h2 class="mt-1 font-semibold text-highlighted">判断人物是否感兴趣</h2>
        <p class="mt-2 text-sm text-muted">保留独立的兴趣判断和可选临时场景。</p>
      </button>
    </div>

    <GenerationArtifactGenerationForm
      v-if="task === 'generation'"
      :personas="personas"
      :image-configured="Boolean(imageCapability?.configured)"
      :loading="loading"
      @submit="submitGeneration"
    />

    <form v-else class="space-y-6" @submit.prevent="submitInterest">
      <section class="workflow-panel" aria-labelledby="interest-heading">
        <div class="section-heading">
          <div class="section-heading-copy">
            <p class="eyebrow">兴趣判断</p>
            <h2 id="interest-heading">说明要判断的内容</h2>
            <p>临时场景只属于本次运行，不会写回人物灵魂、成长或记忆。</p>
          </div>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="人物" required>
            <select v-model="interestForm.personaId" class="native-control" aria-label="使用的人物" required>
              <option value="" disabled>请选择人物</option>
              <option v-for="persona in personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option>
            </select>
          </UFormField>
          <UFormField label="待判断内容" required class="md:col-span-2">
            <UTextarea v-model="interestForm.content" :rows="7" class="w-full" required placeholder="输入希望人物判断是否感兴趣的内容" />
          </UFormField>
          <UFormField label="年龄阶段"><UInput v-model="interestForm.scene.ageStage" class="w-full" /></UFormField>
          <UFormField label="地点"><UInput v-model="interestForm.scene.location" class="w-full" /></UFormField>
          <UFormField label="当前目标"><UInput v-model="interestForm.scene.currentGoal" class="w-full" /></UFormField>
          <UFormField label="情绪"><UInput v-model="interestForm.scene.emotion" class="w-full" /></UFormField>
          <UFormField label="当前事件" class="md:col-span-2"><UTextarea v-model="interestForm.scene.event" :rows="3" class="w-full" /></UFormField>
        </div>
      </section>
      <div class="sticky-action-bar">
        <p class="text-sm text-muted">提交后进入运行详情，系统会自动完成判断。</p>
        <UButton type="submit" size="lg" :disabled="!textCapability?.configured || personas.length === 0" :loading="loading">开始判断</UButton>
      </div>
    </form>
  </div>
</template>
