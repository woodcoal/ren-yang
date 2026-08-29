<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive } from 'vue'
import {
  setupAdministratorInputSchema,
  type SetupAdministratorInput,
} from '#shared/schemas/authentication'

/** 首次设置表单的只读展示属性。 */
interface Props {
  /** 提交请求是否正在执行。 */
  loading: boolean
  /** 页面层返回的安全错误消息。 */
  errorMessage: string | null
}

defineProps<Props>()

const emit = defineEmits<{
  /** 用户通过 Schema 校验后提交管理员信息。 */
  submit: [input: SetupAdministratorInput]
}>()

/** 首次设置表单唯一可变源。 */
const state = reactive({
  username: '',
  password: '',
  passwordConfirmation: '',
})

/**
 * 把 Nuxt UI 已校验的管理员信息上送页面组合层。
 * @param event 包含 Zod 输出的表单提交事件。
 * @returns 无返回值。
 */
function handleSubmit(event: FormSubmitEvent<SetupAdministratorInput>): void {
  emit('submit', event.data)
}
</script>

<template>
  <UForm
    :schema="setupAdministratorInputSchema"
    :state="state"
    class="space-y-5"
    @submit="handleSubmit"
  >
    <UFormField
      name="username"
      label="管理员用户名"
      description="3–50 个文字、数字、下划线或短横线。"
      required
    >
      <UInput
        v-model="state.username"
        autocomplete="username"
        class="w-full"
        :disabled="loading"
      />
    </UFormField>

    <UFormField
      name="password"
      label="管理员密码"
      description="至少 8 个字符；密钥和密码不会写入开发记录。"
      required
    >
      <UInput
        v-model="state.password"
        type="password"
        autocomplete="new-password"
        class="w-full"
        :disabled="loading"
      />
    </UFormField>

    <UFormField
      name="passwordConfirmation"
      label="确认密码"
      required
    >
      <UInput
        v-model="state.passwordConfirmation"
        type="password"
        autocomplete="new-password"
        class="w-full"
        :disabled="loading"
      />
    </UFormField>

    <p
      v-if="errorMessage"
      class="text-sm text-error"
      role="alert"
    >
      {{ errorMessage }}
    </p>

    <UButton
      type="submit"
      block
      :loading="loading"
    >
      创建管理员
    </UButton>
  </UForm>
</template>
