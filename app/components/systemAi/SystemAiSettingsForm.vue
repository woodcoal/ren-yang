<script setup lang="ts">
import { computed } from 'vue'
import type { FormSubmitEvent } from '@nuxt/ui'
import { updateSystemAiSettingsSchema, type SystemAiSettingsValues } from '#shared/schemas/systemAi'
import type { AiModelDeploymentView } from '#shared/types/aiConfiguration'
import type { SystemAiOperation } from '#shared/types/systemAi'
import OperationParameterFields from './OperationParameterFields.vue'

const props = defineProps<{
  /** 保存请求是否正在执行。 */
  loading: boolean
  /** 当前业务选项卡需要编辑的参数组。 */
  operation: SystemAiOperation | null
  /** AI 模型管理中可供选择的全部部署。 */
  deployments: AiModelDeploymentView[]
}>()

const emit = defineEmits<{
  /** 用户提交且共享 Schema 校验通过后，交由页面执行保存。 */
  submit: [values: SystemAiSettingsValues]
}>()

const values = defineModel<SystemAiSettingsValues>({ required: true })
const textModelItems = computed(() => props.deployments
  .filter(item => item.modality === 'text' && item.isEnabled)
  .map(item => ({ label: `${item.name} · ${item.model}`, value: item.id })))
const imageModelItems = computed(() => props.deployments
  .filter(item => item.modality === 'image' && item.isEnabled)
  .map(item => ({ label: `${item.name} · ${item.model}`, value: item.id })))

/**
 * 转发已校验的完整设置，确保保存不会产生隐式的局部继承。
 * @param event Nuxt UI 使用共享 Schema 校验后的表单提交事件。
 * @returns 无返回值；保存状态由页面组件维护。
 */
function handleSubmit(event: FormSubmitEvent<SystemAiSettingsValues>): void {
  emit('submit', event.data)
}
</script>

<template>
  <UForm :schema="updateSystemAiSettingsSchema" :state="values" class="space-y-5" data-system-ai-settings-form @submit="handleSubmit">
    <section v-if="operation === null" class="archive-panel" aria-labelledby="default-models-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">运行模型</p>
          <h2 id="default-models-heading">默认文本与图片模型</h2>
          <p>供人物草稿、世界草稿、反馈分类、头像和图片生成使用；兴趣、灵魂、成长、记忆与文章算法使用各步骤自己的模型。</p>
        </div>
      </div>
      <div class="grid gap-4 lg:grid-cols-2">
        <UFormField name="textModelDeploymentId" label="默认文本模型" description="从 AI 模型管理中选择一个已启用的文本模型。">
          <USelect v-model="values.textModelDeploymentId" class="w-full" :items="textModelItems" value-key="value" placeholder="未选择" />
        </UFormField>
        <UFormField name="imageModelDeploymentId" label="默认图片模型" description="头像和图文图片生成使用；不需要图片时可以留空。">
          <USelect v-model="values.imageModelDeploymentId" class="w-full" :items="imageModelItems" value-key="value" placeholder="未选择" />
        </UFormField>
      </div>
      <UAlert v-if="!textModelItems.length" class="mt-4" color="warning" title="没有可用文本模型" description="请先在 AI 模型管理中新增并启用文本模型部署。" />
    </section>

    <section v-else-if="operation === 'draftGeneration'" class="archive-panel" aria-labelledby="draft-ai-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">快速建立对象</p>
          <h2 id="draft-ai-heading">草稿生成</h2>
          <p>用于根据自然语言生成人物草稿和世界草稿。</p>
        </div>
      </div>
      <OperationParameterFields :model-value="values.draftGeneration" name-prefix="draftGeneration" />
    </section>

    <section v-else class="archive-panel" aria-labelledby="feedback-ai-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">结果归因</p>
          <h2 id="feedback-ai-heading">反馈分类</h2>
          <p>用于判断反馈应作用于产物、参数、资料还是人物成长。</p>
        </div>
      </div>
      <OperationParameterFields :model-value="values.feedbackClassification" name-prefix="feedbackClassification" />
    </section>

    <div class="sticky-action-bar">
      <p class="text-sm text-muted">保存时会连同其他分类的当前参数一起提交；只影响新创建的 AI 操作。</p>
      <UButton type="submit" size="lg" :loading="loading">保存当前 AI 参数</UButton>
    </div>
  </UForm>
</template>
