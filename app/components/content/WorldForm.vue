<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive } from 'vue'
import { createWorldSchema, type CreateWorldInput } from '#shared/schemas/content'

/** 世界创建表单属性。 */
interface Props {
  /** 创建请求是否执行中。 */
  loading: boolean
  /** 服务端安全错误消息。 */
  errorMessage: string | null
}

defineProps<Props>()

const emit = defineEmits<{
  /** Schema 校验通过后提交世界输入。 */
  submit: [input: CreateWorldInput]
}>()

/** 世界创建表单唯一可变状态。 */
const state = reactive<CreateWorldInput>({
  name: '',
  summary: '',
  snapshot: {
    chapters: [{
      id: '00000000-0000-4000-8000-000000000002',
      title: '基本规则与背景',
      content: '',
      order: 0,
      required: true,
    }],
    runtimeSummary: '',
  },
  changeSummary: '建立初始世界设定',
})

/**
 * 上送已校验世界输入。
 * @param event Nuxt UI 表单提交事件。
 * @returns 无返回值。
 */
function handleSubmit(event: FormSubmitEvent<CreateWorldInput>): void {
  emit('submit', event.data)
}
</script>

<template>
  <UForm :schema="createWorldSchema" :state="state" class="space-y-5" @submit="handleSubmit">
    <div class="grid gap-4 md:grid-cols-2">
      <UFormField name="name" label="世界名称" required><UInput v-model="state.name" class="w-full" :disabled="loading" /></UFormField>
      <UFormField name="summary" label="简短说明" description="只方便后台辨认，不会提供给人物。"><UInput v-model="state.summary" class="w-full" :disabled="loading" /></UFormField>
    </div>
    <ContentSoulChapterEditor v-model="state.snapshot" subject-type="world" :disabled="loading" />
    <UFormField name="changeSummary" label="这次写了什么" description="方便以后在修改记录中辨认。" required>
      <UInput v-model="state.changeSummary" class="w-full" :disabled="loading" />
    </UFormField>
    <p v-if="errorMessage" class="text-sm text-error" role="alert">{{ errorMessage }}</p>
    <UButton type="submit" :loading="loading">创建世界并保存灵魂草稿</UButton>
  </UForm>
</template>
