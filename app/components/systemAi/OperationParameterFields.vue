<script setup lang="ts">
import type { SystemAiOperationParameters } from '#shared/schemas/systemAi'

defineProps<{
  /** UForm 字段路径前缀，用于把校验错误定位到具体业务场景。 */
  namePrefix: string
}>()

const parameters = defineModel<SystemAiOperationParameters>({ required: true })
</script>

<template>
  <div class="grid gap-4 md:grid-cols-3">
    <UFormField
      :name="`${namePrefix}.temperature`"
      label="生成随机程度（0–2）"
      description="越低越稳定，越高越有变化。"
      required
    >
      <UInput v-model.number="parameters.temperature" type="number" min="0" max="2" step="0.1" class="w-full" />
    </UFormField>
    <UFormField
      :name="`${namePrefix}.maxOutputTokens`"
      label="单次回答长度上限"
      description="限制一次模型回答最多使用的 Token。"
      required
    >
      <UInput v-model.number="parameters.maxOutputTokens" type="number" min="64" max="8192" step="64" class="w-full" />
    </UFormField>
    <UFormField
      :name="`${namePrefix}.timeoutMs`"
      label="最长等待时间（毫秒）"
      description="超过该时间后本次模型请求失败。"
      required
    >
      <UInput v-model.number="parameters.timeoutMs" type="number" min="1000" max="120000" step="1000" class="w-full" />
    </UFormField>
  </div>
</template>
