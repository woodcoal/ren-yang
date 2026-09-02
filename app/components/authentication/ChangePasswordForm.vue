<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive } from 'vue'
import {
  changeAdministratorPasswordInputSchema,
  type ChangeAdministratorPasswordInput,
} from '#shared/schemas/authentication'

/** 修改管理员密码表单的只读属性。 */
interface Props {
  /** 修改密码请求是否正在执行。 */
  loading: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  /** 当前密码和两次新密码通过共享 Schema 校验后触发。 */
  submit: [input: ChangeAdministratorPasswordInput]
}>()

/** 修改密码表单的唯一可变输入源。 */
const state = reactive<ChangeAdministratorPasswordInput>({
  currentPassword: '',
  newPassword: '',
  newPasswordConfirmation: '',
})

/**
 * 把 Nuxt UI 已校验的密码修改请求交给页面组合层。
 * @param event 包含共享 Zod Schema 输出的表单提交事件。
 * @returns 无返回值。
 */
function handleSubmit(event: FormSubmitEvent<ChangeAdministratorPasswordInput>): void {
  emit('submit', event.data)
}
</script>

<template>
  <UForm
    data-change-password-form
    :schema="changeAdministratorPasswordInputSchema"
    :state="state"
    class="mt-5 space-y-4 border-t border-default pt-5"
    @submit="handleSubmit"
  >
    <UFormField name="currentPassword" label="当前密码" required>
      <UInput
        v-model="state.currentPassword"
        type="password"
        autocomplete="current-password"
        class="w-full"
        :disabled="loading"
      />
    </UFormField>
    <UFormField name="newPassword" label="新密码" description="至少 8 个字符。" required>
      <UInput
        v-model="state.newPassword"
        type="password"
        autocomplete="new-password"
        class="w-full"
        :disabled="loading"
      />
    </UFormField>
    <UFormField name="newPasswordConfirmation" label="确认新密码" required>
      <UInput
        v-model="state.newPasswordConfirmation"
        type="password"
        autocomplete="new-password"
        class="w-full"
        :disabled="loading"
      />
    </UFormField>
    <UButton type="submit" block :loading="loading">修改密码</UButton>
  </UForm>
</template>
