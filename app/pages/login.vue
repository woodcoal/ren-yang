<script setup lang="ts">
import { shallowRef } from 'vue'
import type { LoginInput } from '#shared/schemas/authentication'
import type { AdministratorIdentity, ApiResponse } from '#shared/types/api'
import { getApiErrorMessage } from '../utils/apiError'

definePageMeta({ layout: 'authentication' })

const loading = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)

/**
 * 调用登录接口，并在成功后进入工作台。
 * @param input 登录表单已经校验的数据。
 * @returns 请求和导航完成时结束。
 */
async function handleLogin(input: LoginInput): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    await $fetch<ApiResponse<AdministratorIdentity>>('/api/v1/auth/login', {
      method: 'POST',
      body: input,
    })
    await navigateTo('/')
  }
  catch (error: unknown) {
    errorMessage.value = getApiErrorMessage(error, '登录失败，请检查用户名和密码')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h1 class="text-xl font-semibold text-highlighted">
          管理员登录
        </h1>
        <p class="mt-1 text-sm text-muted">
          本地访问同样需要验证身份。
        </p>
      </div>
    </template>

    <AuthenticationLoginForm
      :loading="loading"
      :error-message="errorMessage"
      @submit="handleLogin"
    />
  </UCard>
</template>
