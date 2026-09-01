<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed } from 'vue'
import { updateSystemAiSettingsSchema, type SystemAiSettingsValues } from '#shared/schemas/systemAi'
import type { AiModelDeploymentView } from '#shared/types/aiConfiguration'

const props = defineProps<{
  /** 当前两个默认模型选择。 */
  modelValue: SystemAiSettingsValues
  /** 模型配置页已加载的全部部署。 */
  deployments: AiModelDeploymentView[]
  /** 默认模型保存请求是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 用户提交且共享 Schema 校验通过后的完整设置。 */
  submit: [values: SystemAiSettingsValues]
}>()

/** Nuxt UI 下拉框使用的非空“未设置”界面值。 */
const EMPTY_MODEL_OPTION = '__not_configured__'
const textModelItems = computed(() => [
  { label: '未设置', value: EMPTY_MODEL_OPTION },
  ...props.deployments
    .filter(item => item.modality === 'text' && item.isEnabled)
    .map(item => ({ label: `${item.name} · ${item.model}`, value: item.id })),
])
const imageModelItems = computed(() => [
  { label: '未设置', value: EMPTY_MODEL_OPTION },
  ...props.deployments
    .filter(item => item.modality === 'image' && item.isEnabled)
    .map(item => ({ label: `${item.name} · ${item.model}`, value: item.id })),
])

/**
 * 把设置契约中的空字符串转换为 Nuxt UI 要求的非空选项值。
 * @param deploymentId 当前默认部署 UUID 或空字符串。
 * @returns 部署 UUID，或仅供界面使用的“未设置”值。
 */
function selectValue(deploymentId: string): string {
  return deploymentId || EMPTY_MODEL_OPTION
}

/**
 * 更新指定类型的默认模型，并把界面“未设置”值还原为空字符串。
 * @param modality 默认文本或图片模型字段。
 * @param value Nuxt UI 下拉框返回的非空选项值。
 * @returns 无返回值；直接修改页面传入的表单状态。
 */
function updateModel(modality: 'textModelDeploymentId' | 'imageModelDeploymentId', value: string): void {
  props.modelValue[modality] = value === EMPTY_MODEL_OPTION ? '' : value
}

/**
 * 转发共享 Schema 已校验的完整默认模型设置。
 * @param event Nuxt UI 表单提交事件及规范化数据。
 * @returns 无返回值；保存状态由页面统一维护。
 */
function handleSubmit(event: FormSubmitEvent<SystemAiSettingsValues>): void {
  emit('submit', event.data)
}
</script>

<template>
  <UForm
    :schema="updateSystemAiSettingsSchema"
    :state="modelValue"
    class="space-y-5"
    data-default-models-form
    @submit="handleSubmit"
  >
    <section class="archive-panel" aria-labelledby="default-models-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">第三步</p>
          <h2 id="default-models-heading">默认文本与图片模型</h2>
          <p>算法步骤未单独选择模型时，自动使用这里配置的同类型模型；显式选择始终优先。</p>
        </div>
      </div>
      <div class="grid gap-4 lg:grid-cols-2">
        <UFormField name="textModelDeploymentId" label="默认文本模型" description="用于未显式绑定文本部署的算法步骤。">
          <USelect :model-value="selectValue(modelValue.textModelDeploymentId)" class="w-full" :items="textModelItems" @update:model-value="updateModel('textModelDeploymentId', $event)" />
        </UFormField>
        <UFormField name="imageModelDeploymentId" label="默认图片模型" description="用于未显式绑定图片部署的算法步骤。">
          <USelect :model-value="selectValue(modelValue.imageModelDeploymentId)" class="w-full" :items="imageModelItems" @update:model-value="updateModel('imageModelDeploymentId', $event)" />
        </UFormField>
      </div>
      <div class="mt-5 flex justify-end">
        <UButton type="submit" :loading="loading">保存默认模型</UButton>
      </div>
    </section>
  </UForm>
</template>
