<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import {
  saveAiModelDeploymentSchema,
  type AiThinkingControlMode,
  type SaveAiModelDeploymentInput,
} from '#shared/schemas/aiConfiguration'
import type { AiConnectionView, AiModelDeploymentView } from '#shared/types/aiConfiguration'

const props = defineProps<{
  /** 可选择的接口连接。 */
  connections: AiConnectionView[]
  /** 正在编辑的部署；为空时创建。 */
  deployment: AiModelDeploymentView | null
  /** 保存请求是否执行中。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 校验通过后提交完整模型部署参数。 */
  save: [input: SaveAiModelDeploymentInput]
  /** 编辑状态下请求返回新建模式。 */
  cancel: []
}>()

const validationError = shallowRef<string | null>(null)
const connectionItems = computed(() => props.connections.map(connection => ({
  label: connection.isEnabled ? connection.name : `${connection.name}（未启用）`,
  value: connection.id,
})))
const form = reactive<SaveAiModelDeploymentInput>({
  connectionId: props.deployment?.connectionId ?? props.connections.find(item => item.isEnabled)?.id ?? '',
  name: props.deployment?.name ?? '',
  model: props.deployment?.model ?? '',
  modality: props.deployment?.modality ?? 'text',
  thinkingControl: props.deployment?.thinkingControl ?? 'none',
  isEnabled: props.deployment?.isEnabled ?? true,
})
/** 文本模型关闭思考字段始终向下拉框提供有效选项值，避免可选 API 输入破坏双向绑定。 */
const thinkingControl = computed<AiThinkingControlMode>({
  get: () => form.thinkingControl ?? 'none',
  set: value => { form.thinkingControl = value },
})

/**
 * 校验完整部署参数并交给页面保存。
 * @returns 校验失败时仅更新错误，成功时发出保存事件。
 */
function submit(): void {
  validationError.value = null
  const parsed = saveAiModelDeploymentSchema.safeParse(form)
  if (!parsed.success) {
    validationError.value = parsed.error.issues[0]?.message ?? '模型部署参数无效'
    return
  }
  emit('save', parsed.data)
}
</script>

<template>
  <section class="archive-panel" aria-labelledby="ai-deployment-editor-heading">
    <div class="section-heading">
      <div class="section-heading-copy">
        <p class="eyebrow">具体模型</p>
        <h2 id="ai-deployment-editor-heading">{{ deployment ? '编辑模型部署' : '新建模型部署' }}</h2>
        <p>同一个接口可以登记多个文本或图片模型；算法步骤选择具体部署。</p>
      </div>
    </div>
    <UAlert v-if="validationError" class="mb-4" color="error" title="参数无效" :description="validationError" />
    <UAlert v-if="connections.length === 0" color="warning" title="请先创建接口连接" />
    <form v-else class="space-y-4" data-ai-deployment-form @submit.prevent="submit">
      <UFormField label="所属接口" required><USelect v-model="form.connectionId" class="w-full" :items="connectionItems" /></UFormField>
      <UFormField label="部署名称" description="用于算法配置中识别，例如“主力推理模型”。" required><UInput v-model="form.name" class="w-full" /></UFormField>
      <UFormField label="供应商模型标识" required><UInput v-model="form.model" class="w-full" placeholder="model-name" /></UFormField>
      <UFormField label="模型类型" required><USelect v-model="form.modality" class="w-full" :items="[{ label: '文本', value: 'text' }, { label: '图片', value: 'image' }]" /></UFormField>
      <UFormField v-if="form.modality === 'text'" label="关闭思考字段" description="算法步骤启用关闭思考时，只按此格式发送一个供应商字段。">
        <USelect v-model="thinkingControl" class="w-full" :items="[
          { label: '不支持 / 不发送', value: 'none' },
          { label: 'enable_thinking: false', value: 'enable_thinking' },
          { label: 'reasoning_effort: none', value: 'reasoning_effort' },
          { label: 'reasoning: { enabled: false }', value: 'reasoning' },
        ]" />
      </UFormField>
      <UCheckbox v-model="form.isEnabled" label="允许新算法配置使用此模型" />
      <div class="flex flex-wrap gap-2">
        <UButton type="submit" :loading="loading">{{ deployment ? '保存模型' : '创建模型' }}</UButton>
        <UButton v-if="deployment" type="button" color="neutral" variant="soft" @click="emit('cancel')">取消编辑</UButton>
      </div>
    </form>
  </section>
</template>
