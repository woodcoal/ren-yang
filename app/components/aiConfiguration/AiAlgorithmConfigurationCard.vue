<script setup lang="ts">
import { reactive, shallowRef } from 'vue'
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
  /** 请求在当前算法页编辑指定步骤的提示词。 */
  editPrompt: [code: string]
}>()

/** Nuxt UI 下拉框使用的非空“继承默认模型”界面值。 */
const DEFAULT_MODEL_OPTION = '__default_model__'
/** 新发布图片步骤默认使用的单边最大像素，旧配置未保存该值时继续不裁剪。 */
const DEFAULT_IMAGE_MAX_DIMENSION = 2_048
const validationError = shallowRef<string | null>(null)
const form = reactive<PublishAiAlgorithmConfigurationInput>({
  steps: props.algorithm.stepDefinitions.map((definition) => {
    const active = props.algorithm.steps.find(step => step.key === definition.key)
    const parameters = active?.parameters ?? { temperature: 0.2, maxOutputTokens: 4_096, timeoutMs: 0 }
    const textParameters = {
      ...parameters,
      disableThinking: parameters.disableThinking ?? false,
    }
    return {
      stepKey: definition.key,
      modelDeploymentId: active?.modelDeploymentId ?? '',
      parameters: definition.modality === 'image'
        ? {
          ...parameters,
          maxImageWidth: parameters.maxImageWidth ?? DEFAULT_IMAGE_MAX_DIMENSION,
          maxImageHeight: parameters.maxImageHeight ?? DEFAULT_IMAGE_MAX_DIMENSION,
        }
        : textParameters,
    }
  }),
})

/**
 * 返回一个固定算法步骤可选择的同类型模型部署。
 * @param modality 步骤在代码中固定的文本或图片模型类型。
 * @returns 保留未启用状态说明的下拉选项。
 */
function deploymentItems(modality: 'text' | 'image'): Array<{ label: string, value: string }> {
  return [
    { label: `使用默认${modality === 'text' ? '文本' : '图片'}模型`, value: DEFAULT_MODEL_OPTION },
    ...props.deployments
      .filter(item => item.modality === modality)
      .map(item => ({ label: item.isEnabled ? item.name : `${item.name}（未启用）`, value: item.id })),
  ]
}

/**
 * 把持久化空值转换为 Nuxt UI 下拉框要求的非空选项值。
 * @param deploymentId 当前算法步骤显式部署 UUID 或空字符串。
 * @returns 显式部署 UUID，或仅供界面使用的默认模型选项值。
 */
function deploymentSelectValue(deploymentId: string): string {
  return deploymentId || DEFAULT_MODEL_OPTION
}

/**
 * 把下拉框选择还原为算法配置契约中的部署 UUID 或空字符串。
 * @param index 当前固定步骤在表单中的位置。
 * @param value Nuxt UI 下拉框返回的非空选项值。
 * @returns 无返回值；直接更新对应步骤模型选择。
 */
function updateDeployment(index: number, value: string): void {
  form.steps[index]!.modelDeploymentId = value === DEFAULT_MODEL_OPTION ? '' : value
}

/**
 * 返回图片步骤已初始化的最大裁剪尺寸，避免可选历史字段向数值输入传递空值。
 * @param index 当前固定步骤在表单中的位置。
 * @param field 最大宽度或最大高度字段。
 * @returns 已保存尺寸，旧配置缺失时返回新配置默认上限。
 */
function imageDimension(index: number, field: 'maxImageWidth' | 'maxImageHeight'): number {
  return form.steps[index]?.parameters[field] ?? DEFAULT_IMAGE_MAX_DIMENSION
}

/**
 * 把 Nuxt UI 数值输入更新写回指定图片裁剪字段。
 * @param index 当前固定步骤在表单中的位置。
 * @param field 最大宽度或最大高度字段。
 * @param value 数值输入组件返回的原始值。
 * @returns 步骤存在时更新字段，否则不执行操作。
 */
function updateImageDimension(
  index: number,
  field: 'maxImageWidth' | 'maxImageHeight',
  value: string | number | bigint | boolean | null,
): void {
  const step = form.steps[index]
  if (!step) return
  step.parameters[field] = Number(value)
}

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
  <article class="archive-panel" :aria-labelledby="`algorithm-${algorithm.code}-heading`"
    :data-algorithm-code="algorithm.code">
    <div class="section-heading">
      <div class="section-heading-copy">
        <p class="eyebrow">实现 v{{ algorithm.implementationVersion }} · 配置 {{ algorithm.activeConfigurationVersion ?
          `v${algorithm.activeConfigurationVersion}` : '未发布' }}</p>
        <h2 :id="`algorithm-${algorithm.code}-heading`">{{ algorithm.name }}</h2>
        <p>{{ algorithm.description }}</p>
      </div>
      <UBadge :color="algorithm.activeConfigurationVersion ? 'success' : 'warning'" variant="subtle">{{
        algorithm.activeConfigurationVersion ? '已配置' : '待配置' }}</UBadge>
    </div>
    <UAlert v-if="validationError" class="mb-4" color="error" title="配置无效" :description="validationError" />
    <form class="space-y-5" data-ai-algorithm-form @submit.prevent="submit">
      <section v-for="(definition, index) in algorithm.stepDefinitions" :key="definition.key"
        class="rounded-lg border border-default p-4">
        <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="font-medium text-highlighted">{{ index + 1 }}. {{ definition.name }}</h3>
            <p class="mt-1 text-sm text-muted">{{ definition.description }}</p>
          </div>
          <UButton type="button" size="xs" color="neutral" variant="soft" icon="i-lucide-braces"
            @click="emit('editPrompt', definition.promptCode)">编辑该步骤提示词</UButton>
        </div>
        <p class="mb-4 break-all text-xs text-muted">固定编码：<code>{{ definition.promptCode }}</code></p>
        <div class="grid gap-4 md:grid-cols-4">
          <UFormField :label="definition.modality === 'text' ? '文本模型' : '图片模型'">
            <USelect :model-value="deploymentSelectValue(form.steps[index]!.modelDeploymentId)" class="w-full"
              :items="deploymentItems(definition.modality)" @update:model-value="updateDeployment(index, $event)" />
          </UFormField>
          <UFormField v-if="definition.modality === 'text'" label="温度" required>
            <UInput v-model.number="form.steps[index]!.parameters.temperature" class="w-full" type="number" min="0"
              max="2" step="0.1" />
          </UFormField>
          <UFormField v-if="definition.modality === 'text'" label="输出 Token" required>
            <UInput v-model.number="form.steps[index]!.parameters.maxOutputTokens" class="w-full" type="number" min="0"
              step="64" />
          </UFormField>
          <UFormField v-if="definition.modality === 'text'" label="思考模式" description="仅在所选模型部署已配置关闭思考字段时生效。">
            <UCheckbox v-model="form.steps[index]!.parameters.disableThinking" label="关闭思考" />
          </UFormField>
          <UFormField v-if="definition.modality === 'image'" label="最大宽度（像素）" required>
            <UInput :model-value="imageDimension(index, 'maxImageWidth')" class="w-full" type="number" min="64"
              max="8192" step="64" @update:model-value="updateImageDimension(index, 'maxImageWidth', $event)" />
          </UFormField>
          <UFormField v-if="definition.modality === 'image'" label="最大高度（像素）" required>
            <UInput :model-value="imageDimension(index, 'maxImageHeight')" class="w-full" type="number" min="64"
              max="8192" step="64" @update:model-value="updateImageDimension(index, 'maxImageHeight', $event)" />
          </UFormField>
          <UFormField label="超时（毫秒）" description="0 表示使用模型默认超时。" required>
            <UInput v-model.number="form.steps[index]!.parameters.timeoutMs" class="w-full" type="number" min="0"
              max="120000" step="1000" />
          </UFormField>
        </div>
      </section>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted">每次保存发布新配置版本；已创建任务继续使用原快照。</p>
        <UButton type="submit" :loading="loading">发布算法配置</UButton>
      </div>
    </form>
  </article>
</template>
