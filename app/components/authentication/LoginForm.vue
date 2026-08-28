<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive } from 'vue'
import { loginInputSchema, type LoginInput } from '#shared/schemas/authentication'

/** 登录表单的只读展示属性。 */
interface Props {
  /** 提交请求是否正在执行。 */
  loading: boolean
  /** 页面层返回的安全错误消息。 */
  errorMessage: string | null
}

defineProps<Props>()

const emit = defineEmits<{
  /** 用户通过 Schema 校验后提交登录信息。 */
  submit: [input: LoginInput]
}>()

/** 表单唯一可变源，派生校验由 Zod 和 Nuxt UI 负责。 */
const state = reactive({
  username: '',
  password: '',
})

/**
 * 把 Nuxt UI 已校验的表单数据上送页面组合层。
 * @param event 包含 Zod 输出的表单提交事件。
 * @returns 无返回值。
 */
function handleSubmit(event: FormSubmitEvent<LoginInput>): void {
  emit('submit', event.data)
}
</script>

<template>
  <UForm
    :schema="loginInputSchema"
    :state="state"
    class="space-y-5"
    @submit="handleSubmit"
  >
    <UFormField
      name="username"
      label="用户名"
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
      label="密码"
      required
    >
      <UInput
        v-model="state.password"
        type="password"
        autocomplete="current-password"
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
      登录
    </UButton>
  </UForm>
</template>
