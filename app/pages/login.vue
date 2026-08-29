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
  <section class="auth-form-panel" aria-labelledby="login-form-title">
    <p class="eyebrow">登录</p>
    <h2 id="login-form-title">验证本机管理员</h2>
    <p class="auth-form-introduction">请输入此设备上已设置的唯一管理员身份和密码。</p>

    <AuthenticationLoginForm
      :loading="loading"
      :error-message="errorMessage"
      @submit="handleLogin"
    />

    <div class="auth-local-help">
      <strong>无法恢复管理员密码？</strong>
      <p>请在运行人样的本机终端中使用管理员密码重置命令。系统不提供在线重置链接。</p>
    </div>
  </section>
</template>
