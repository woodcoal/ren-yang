<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaSummary } from '#shared/types/content'
import type { CreatedRun, FormatTemplateView, ImageModelCapability, ParameterProfileView, TextModelCapability } from '#shared/types/generation'
import { getApiErrorMessage } from '../utils/apiError'

/** 系统能力接口中创作工作台需要的字段。 */
interface CapabilityResponse {
  textModel: TextModelCapability
  imageModel: ImageModelCapability
  openViking: { configured: boolean, enabled: boolean }
  contextProvider: 'sqlite_fts5' | 'openviking'
}

const [{ data: personaData }, { data: profileData }, { data: templateData }, { data: capabilityData }] = await Promise.all([
  useFetch<ApiResponse<PersonaSummary[]>>('/api/v1/personas'),
  useFetch<ApiResponse<ParameterProfileView[]>>('/api/v1/parameter-profiles'),
  useFetch<ApiResponse<FormatTemplateView[]>>('/api/v1/format-templates'),
  useFetch<ApiResponse<CapabilityResponse>>('/api/v1/system/capabilities'),
])

const personas = computed(() => (personaData.value?.data ?? []).filter(persona => persona.activeVersionId))
const profiles = computed(() => profileData.value?.data ?? [])
const templates = computed(() => templateData.value?.data ?? [])
const capabilities = computed(() => capabilityData.value?.data ?? null)
const textCapability = computed(() => capabilities.value?.textModel ?? null)
const imageCapability = computed(() => capabilities.value?.imageModel ?? null)
const loading = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)
const form = reactive({
  task: 'interest' as 'interest' | 'generation',
  personaId: '',
  content: '',
  parameterProfileId: null as string | null,
  formatTemplateId: null as string | null,
  includeImages: false,
  scene: { ageStage: '', location: '', currentGoal: '', emotion: '', event: '' },
})

/** @returns 创建异步运行并进入可轮询的运行详情页。 */
async function submitRun(): Promise<void> {
  errorMessage.value = null
  if (!form.personaId || !form.content.trim()) {
    errorMessage.value = '必须选择已发布人物并填写任务内容'
    return
  }
  loading.value = true
  try {
    const common = {
      personaId: form.personaId,
      scene: { ...form.scene },
      parameterProfileId: form.parameterProfileId,
    }
    const response = form.task === 'interest'
      ? await $fetch<ApiResponse<CreatedRun>>('/api/v1/interest-runs', { method: 'POST', body: { ...common, content: form.content } })
      : await $fetch<ApiResponse<CreatedRun>>('/api/v1/generation-runs', {
          method: 'POST',
          body: { ...common, requirement: form.content, formatTemplateId: form.formatTemplateId, includeImages: form.includeImages },
        })
    await navigateTo(`/runs/${response.data.runId}`)
  }
  catch (error: unknown) {
    errorMessage.value = getApiErrorMessage(error, '创建运行失败')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <ContentPageHeader title="新建任务" description="选择人物并说明任务。临时场景只影响这一次，不会改写人物设定。">
      <UButton to="/history" color="neutral" variant="ghost">运行历史</UButton>
    </ContentPageHeader>

    <UAlert v-if="!textCapability?.configured" class="mb-5" color="warning" title="文本模型未配置" description="请通过环境变量配置 OpenAI-compatible 接口后重启服务；密钥不会进入数据库。" />
    <UAlert v-if="errorMessage" class="mb-5" color="error" title="无法创建运行" :description="errorMessage" />

    <form class="space-y-6" @submit.prevent="submitRun">
      <UCard>
        <template #header><h2 class="font-semibold text-highlighted">任务</h2></template>
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="任务类型" required>
            <select v-model="form.task" class="native-control" aria-label="任务类型"><option value="interest">判断人物兴趣</option><option value="generation">结构化图文创作</option></select>
          </UFormField>
          <UFormField label="使用的人物" description="只显示已经确认使用人物设定的对象。" required>
            <select v-model="form.personaId" class="native-control" aria-label="使用的人物">
              <option value="" disabled>请选择人物</option><option v-for="persona in personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option>
            </select>
          </UFormField>
          <UFormField label="生成设置">
            <select v-model="form.parameterProfileId" class="native-control" aria-label="生成设置"><option :value="null">系统默认</option><option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.name }} v{{ profile.version }}</option></select>
          </UFormField>
          <UFormField v-if="form.task === 'generation'" label="内容格式">
            <select v-model="form.formatTemplateId" class="native-control" aria-label="内容格式"><option :value="null">默认文档结构</option><option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }} v{{ template.version }}</option></select>
          </UFormField>
          <UFormField v-if="form.task === 'generation'" label="图片能力">
            <label class="flex items-start gap-3 rounded-md border border-default p-3 text-sm">
              <input v-model="form.includeImages" type="checkbox" class="mt-1" :disabled="!imageCapability?.configured">
              <span><strong class="block text-highlighted">允许规划图片块</strong><span class="text-muted">{{ imageCapability?.configured ? '图片用于辅助表达，不承诺人物外观一致。' : '图片模型未配置，当前只能生成纯文本。' }}</span></span>
            </label>
          </UFormField>
          <UFormField :label="form.task === 'interest' ? '待判断内容' : '创作要求'" required class="md:col-span-2">
            <UTextarea v-model="form.content" :rows="7" class="w-full" :placeholder="form.task === 'interest' ? '输入希望人物判断是否感兴趣的内容' : '说明主题、受众、篇幅和希望的表达形式'" />
          </UFormField>
        </div>
      </UCard>

      <UCard>
        <template #header><div><h2 class="font-semibold text-highlighted">这次任务中的临时场景</h2><p class="mt-1 text-sm text-muted">可选，只影响本次判断或创作，不会保存进人物设定。</p></div></template>
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="年龄阶段"><UInput v-model="form.scene.ageStage" class="w-full" /></UFormField>
          <UFormField label="地点"><UInput v-model="form.scene.location" class="w-full" /></UFormField>
          <UFormField label="当前目标"><UInput v-model="form.scene.currentGoal" class="w-full" /></UFormField>
          <UFormField label="情绪"><UInput v-model="form.scene.emotion" class="w-full" /></UFormField>
          <UFormField label="当前事件" class="md:col-span-2"><UTextarea v-model="form.scene.event" :rows="3" class="w-full" /></UFormField>
        </div>
      </UCard>

      <UButton type="submit" size="lg" :disabled="!textCapability?.configured || personas.length === 0" :loading="loading">
        {{ form.task === 'interest' ? '开始判断' : '开始规划内容' }}
      </UButton>
    </form>
  </div>
</template>
