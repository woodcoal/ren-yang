<script setup lang="ts">
import { reactive, shallowRef } from 'vue'
import {
  createAiConnectionSchema,
  updateAiConnectionSchema,
  type CreateAiConnectionInput,
  type UpdateAiConnectionInput,
} from '#shared/schemas/aiConfiguration'
import type { AiConnectionView } from '#shared/types/aiConfiguration'

const props = defineProps<{
  /** 正在编辑的连接；为空时创建新连接。 */
  connection: AiConnectionView | null
  /** 保存请求是否执行中。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 校验通过后提交新建或编辑参数。 */
  save: [input: CreateAiConnectionInput | UpdateAiConnectionInput]
  /** 编辑状态下请求返回新建模式。 */
  cancel: []
}>()

const validationError = shallowRef<string | null>(null)
const form = reactive({
  name: props.connection?.name ?? '',
  protocol: 'openai_compatible' as const,
  endpoint: props.connection?.endpoint ?? '',
  userAgent: props.connection?.userAgent ?? '',
  apiKey: '',
  isEnabled: props.connection?.isEnabled ?? true,
})

/**
 * 使用共享 Schema 区分新建与编辑密钥语义并提交。
 * @returns 校验失败时仅更新组件错误，成功时发出保存事件。
 */
function submit(): void {
  validationError.value = null
  const candidate = props.connection && form.apiKey.trim().length === 0
    ? { name: form.name, protocol: form.protocol, endpoint: form.endpoint, userAgent: form.userAgent, isEnabled: form.isEnabled }
    : { ...form }
  const parsed = props.connection
    ? updateAiConnectionSchema.safeParse(candidate)
    : createAiConnectionSchema.safeParse(candidate)
  if (!parsed.success) {
    validationError.value = parsed.error.issues[0]?.message ?? '连接参数无效'
    return
  }
  emit('save', parsed.data)
}
</script>

<template>
  <section class="archive-panel" aria-labelledby="ai-connection-editor-heading">
    <div class="section-heading">
      <div class="section-heading-copy">
        <p class="eyebrow">接口连接</p>
        <h2 id="ai-connection-editor-heading">{{ connection ? '编辑接口' : '新建接口' }}</h2>
        <p>API Key 只会加密后保存；编辑时留空表示保留原密钥。</p>
      </div>
    </div>
    <UAlert v-if="validationError" class="mb-4" color="error" title="参数无效" :description="validationError" />
    <form class="space-y-4" data-ai-connection-form @submit.prevent="submit">
      <UFormField label="接口名称" required><UInput v-model="form.name" class="w-full" /></UFormField>
      <UFormField label="协议" required><USelect v-model="form.protocol" class="w-full" :items="[{ label: 'OpenAI-compatible', value: 'openai_compatible' }]" /></UFormField>
      <UFormField label="接口地址" description="填写 API 根地址或兼容接口地址。" required><UInput v-model="form.endpoint" class="w-full" placeholder="https://example.com/v1" /></UFormField>
      <UFormField label="UserAgent" description="调用该接口时发送的 User-Agent 请求头；留空使用运行环境默认值。">
        <UInput v-model="form.userAgent" class="w-full" placeholder="RenYang/1.0" autocomplete="off" />
      </UFormField>
      <UFormField :label="connection ? '更新 API Key' : 'API Key'" :description="connection ? '留空保留当前密钥。' : '密钥不会返回到浏览器。'" :required="!connection">
        <UInput v-model="form.apiKey" class="w-full" type="password" autocomplete="new-password" />
      </UFormField>
      <UCheckbox v-model="form.isEnabled" label="允许新算法配置使用此接口" />
      <div class="flex flex-wrap gap-2">
        <UButton type="submit" :loading="loading">{{ connection ? '保存接口' : '创建接口' }}</UButton>
        <UButton v-if="connection" type="button" color="neutral" variant="soft" @click="emit('cancel')">取消编辑</UButton>
      </div>
    </form>
  </section>
</template>
