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
  <UCard>
    <template #header>
      <div>
        <h1 class="text-xl font-semibold text-highlighted">
          首次设置
        </h1>
        <p class="mt-1 text-sm text-muted">
          创建唯一管理员。此操作只允许从应用所在机器完成。
        </p>
      </div>
    </template>

    <AuthenticationSetupForm
      :loading="loading"
      :error-message="errorMessage"
      @submit="handleSetup"
    />
  </UCard>
</template>
