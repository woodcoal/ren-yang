<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreateApiKeyInput } from '#shared/schemas/publicApi'
import type { ApiResponse } from '#shared/types/api'
import type { ApiKeyView, CreatedApiKeyView } from '#shared/types/publicApi'
import { getApiErrorMessage } from '../../utils/apiError'

const { data, error, refresh } = await useFetch<ApiResponse<ApiKeyView[]>>('/api/v1/api-keys')
const keys = computed(() => data.value?.data ?? [])
const created = shallowRef<CreatedApiKeyView | null>(null)
const createDialogOpen = shallowRef(false)
const creating = shallowRef(false)
const revokingId = shallowRef<string | null>(null)
const deletingId = shallowRef<string | null>(null)
const { notifySuccess, notifyError } = useOperationNotifications()

/**
 * 创建新 Key，并只在当前组件内存中保留本次返回的完整明文。
 * @param input 已由表单整理的名称、权限和到期时间。
 * @returns 创建与列表刷新完成时结束。
 */
async function createKey(input: CreateApiKeyInput): Promise<void> {
  if (creating.value) return
  creating.value = true
  try {
    const response = await $fetch<ApiResponse<CreatedApiKeyView>>('/api/v1/api-keys', { method: 'POST', body: input })
    created.value = response.data
    createDialogOpen.value = false
    await refresh()
    notifySuccess('完整 Key 只在当前提示中展示一次', 'API Key 已创建')
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, 'API Key 创建失败'), 'API Key 创建失败')
  }
  finally {
    creating.value = false
  }
}

/**
 * 吊销指定 Key 并刷新列表；完整 Key 无法通过此动作恢复。
 * @param id API Key 稳定标识。
 * @returns 吊销与刷新完成时结束。
 */
async function revokeKey(id: string): Promise<void> {
  if (revokingId.value) return
  revokingId.value = id
  try {
    const response = await $fetch<ApiResponse<ApiKeyView>>(
      `/api/v1/api-keys/${encodeURIComponent(id)}/revoke`,
      { method: 'POST' },
    )
    if (data.value) {
      data.value = { data: data.value.data.map(key => key.id === id ? response.data : key) }
    }
    await refresh()
    notifySuccess('该 Key 的下一次公共请求将返回 401', 'API Key 已吊销')
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, 'API Key 吊销失败'), 'API Key 吊销失败')
  }
  finally {
    revokingId.value = null
  }
}

/**
 * 永久删除指定已吊销 Key，并在成功后刷新安全列表。
 * @param id 已吊销 API Key 的稳定标识。
 * @returns 删除和列表刷新完成时结束。
 */
async function deleteKey(id: string): Promise<void> {
  if (deletingId.value) return
  deletingId.value = id
  try {
    await $fetch(`/api/v1/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (data.value) data.value = { data: data.value.data.filter(key => key.id !== id) }
    await refresh()
    notifySuccess('该 Key 及其公共调用明细已永久删除', 'API Key 已删除')
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, 'API Key 删除失败'), 'API Key 删除失败')
  }
  finally {
    deletingId.value = null
  }
}

/**
 * 关闭一次性明文提示并从组件内存移除完整 Key。
 * @returns 无返回值。
 * @remarks 关闭后无接口可以恢复该明文。
 */
function dismissCreatedSecret(): void {
  created.value = null
}
</script>

<template>
  <div class="space-y-6">
    <UAlert v-if="error" color="error" title="API Key 列表加载失败" />
    <ApiKeyCreatedSecret v-if="created" :secret="created.secret" @dismiss="dismissCreatedSecret" />
    <div class="flex justify-end">
      <UButton icon="i-lucide-plus" @click="createDialogOpen = true">创建 API Key</UButton>
    </div>
    <ApiKeyList
      :keys="keys"
      :revoking-id="revokingId"
      :deleting-id="deletingId"
      @revoke="revokeKey"
      @delete="deleteKey"
    />

    <UModal v-model:open="createDialogOpen" title="创建 API Key" description="为外部调用方选择最少权限和可选到期时间。">
      <template #body>
        <ApiKeyCreateForm :loading="creating" @submit="createKey" />
      </template>
    </UModal>
  </div>
</template>
