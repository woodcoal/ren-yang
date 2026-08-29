<script setup lang="ts">
import { shallowRef } from 'vue'
import type { SetupAdministratorInput } from '#shared/schemas/authentication'
import type { AdministratorIdentity, ApiResponse } from '#shared/types/api'
import { getApiErrorMessage } from '../utils/apiError'

definePageMeta({ layout: 'authentication' })

const loading = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)

/**
 * 调用本机首次设置接口，并在成功后进入工作台。
 * @param input 首次设置表单已经校验的数据。
 * @returns 请求和导航完成时结束。
 */
async function handleSetup(input: SetupAdministratorInput): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    await $fetch<ApiResponse<AdministratorIdentity>>('/api/v1/setup/admin', {
      method: 'POST',
      body: input,
    })
    await navigateTo('/')
  }
  catch (error: unknown) {
    errorMessage.value = getApiErrorMessage(error, '管理员创建失败')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="auth-form-panel" aria-labelledby="setup-form-title">
    <p class="eyebrow">首次设置</p>
    <h2 id="setup-form-title">准备本机工作台</h2>
    <p class="auth-form-introduction">创建这台设备上的唯一管理员。此操作只允许从应用所在机器完成。</p>

    <AuthenticationSetupForm
      :loading="loading"
      :error-message="errorMessage"
      @submit="handleSetup"
    />

    <div class="auth-local-help">
      <strong>设置完成后</strong>
      <p>你可以建立人物、整理资料并开始任务；任何会影响后续任务的内容仍需人工确认。</p>
    </div>
  </section>
</template>
