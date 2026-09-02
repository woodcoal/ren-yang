<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive } from 'vue'
import { updateLearningAutomationSettingsSchema, type UpdateLearningAutomationSettingsInput } from '#shared/schemas/learningAutomation'
import type { LearningAutomationSettingsView } from '#shared/types/learningAutomation'

const props = defineProps<{
  settings: LearningAutomationSettingsView
  loading: boolean
}>()

const emit = defineEmits<{
  submit: [input: UpdateLearningAutomationSettingsInput]
}>()

const state = reactive<UpdateLearningAutomationSettingsInput>({ intervalHours: props.settings.intervalHours })

/**
 * 提交已通过共享 Schema 校验的统一执行周期。
 * @param event Nuxt UI 表单提交事件。
 * @returns 无返回值。
 */
function submitSettings(event: FormSubmitEvent<UpdateLearningAutomationSettingsInput>): void {
  emit('submit', event.data)
}
</script>

<template>
  <UForm
    data-learning-automation-settings
    :schema="updateLearningAutomationSettingsSchema"
    :state="state"
    class="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end"
    @submit="submitSettings"
  >
    <UFormField name="intervalHours" label="执行周期（小时）" description="允许 1–720 小时；保存后从当前时间重新计算下次执行时间。">
      <UInputNumber v-model="state.intervalHours" class="w-full sm:w-48" :min="1" :max="720" :step="1" />
    </UFormField>
    <UButton type="submit" :loading="props.loading">保存周期</UButton>
  </UForm>
</template>
