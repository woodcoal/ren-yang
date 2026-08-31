<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import {
  publishAiAlgorithmConfigurationSchema,
  type PublishAiAlgorithmConfigurationInput,
} from '#shared/schemas/aiConfiguration'
import type { AiAlgorithmView, AiModelDeploymentView } from '#shared/types/aiConfiguration'

const props = defineProps<{
  /** 固定算法及当前配置。 */
  algorithm: AiAlgorithmView
  /** 可选择的全部模型部署。 */
  deployments: AiModelDeploymentView[]
  /** 当前算法保存请求是否执行中。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 校验固定步骤集合后请求发布新配置版本。 */
  save: [input: PublishAiAlgorithmConfigurationInput]
}>()

const validationError = shallowRef<string | null>(null)
const deploymentItems = computed(() => props.deployments
  .filter(item => item.modality === 'text')
  .map(item => ({ label: item.isEnabled ? item.name : `${item.name}（未启用）`, value: item.id })))
const form = reactive<PublishAiAlgorithmConfigurationInput>({
  steps: props.algorithm.stepDefinitions.map((definition) => {
    const active = props.algorithm.steps.find(step => step.key === definition.key)
    return {
      stepKey: definition.key,
      modelDeploymentId: active?.modelDeploymentId ?? '',
      parameters: active?.parameters ?? { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 60_000 },
    }
  }),
})

/**
 * 校验完整固定步骤集合并请求发布不可变配置版本。
 * @returns 校验失败时仅展示错误，成功时发出保存事件。
 */
function submit(): void {
  validationError.value = null
  const parsed = publishAiAlgorithmConfigurationSchema.safeParse(form)
  if (!parsed.success) {
    validationError.value = parsed.error.issues[0]?.message ?? '算法配置无效'
    return
  }
  emit('save', parsed.data)
}
</script>

<template>
  <article class="archive-panel" :aria-labelledby="`algorithm-${algorithm.code}-heading`" :data-algorithm-code="algorithm.code">
    <div class="section-heading">
      <div class="section-heading-copy">
        <p class="eyebrow">实现 v{{ algorithm.implementationVersion }} · 配置 {{ algorithm.activeConfigurationVersion ? `v${algorithm.activeConfigurationVersion}` : '未发布' }}</p>
        <h2 :id="`algorithm-${algorithm.code}-heading`">{{ algorithm.name }}</h2>
        <p>{{ algorithm.description }}</p>
      </div>
      <UBadge :color="algorithm.activeConfigurationVersion ? 'success' : 'warning'" variant="subtle">{{ algorithm.activeConfigurationVersion ? '已配置' : '待配置' }}</UBadge>
    </div>
    <UAlert v-if="validationError" class="mb-4" color="error" title="配置无效" :description="validationError" />
    <UAlert v-if="deploymentItems.length === 0" color="warning" title="没有文本模型部署" description="请先在 AI 模型页面创建并启用文本模型。" />
    <form v-else class="space-y-5" data-ai-algorithm-form @submit.prevent="submit">
      <section v-for="(definition, index) in algorithm.stepDefinitions" :key="definition.key" class="rounded-lg border border-default p-4">
        <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div><h3 class="font-medium text-highlighted">{{ index + 1 }}. {{ definition.name }}</h3><p class="mt-1 text-sm text-muted">{{ definition.description }}</p></div>
          <NuxtLink to="/prompts" class="text-xs text-primary">提示词：{{ definition.promptCode }}</NuxtLink>
        </div>
        <div class="grid gap-4 md:grid-cols-4">
          <UFormField label="文本模型" required><USelect v-model="form.steps[index]!.modelDeploymentId" class="w-full" :items="deploymentItems" /></UFormField>
          <UFormField label="温度" required><UInput v-model.number="form.steps[index]!.parameters.temperature" class="w-full" type="number" min="0" max="2" step="0.1" /></UFormField>
          <UFormField label="输出 Token" required><UInput v-model.number="form.steps[index]!.parameters.maxOutputTokens" class="w-full" type="number" min="64" max="8192" step="64" /></UFormField>
          <UFormField label="超时（毫秒）" required><UInput v-model.number="form.steps[index]!.parameters.timeoutMs" class="w-full" type="number" min="1000" max="120000" step="1000" /></UFormField>
        </div>
      </section>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted">每次保存发布新配置版本；已创建任务继续使用原快照。</p>
        <UButton type="submit" :loading="loading">发布算法配置</UButton>
      </div>
    </form>
  </article>
</template>
