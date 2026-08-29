<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { ContextReindexResult, ContextSyncRecordView, OpenVikingCapabilityView } from '#shared/types/context'
import { getApiErrorMessage } from '../utils/apiError'

/** 系统能力响应中本页面使用的上下文部分。 */
interface CapabilityResponse {
  openViking: OpenVikingCapabilityView
  contextProvider: 'sqlite_fts5' | 'openviking'
}

/** 上下文同步状态接口。 */
interface ContextStatusResponse {
  capability: OpenVikingCapabilityView
  records: ContextSyncRecordView[]
}

const [{ data: capabilityData, error: capabilityError, refresh: refreshCapabilities }, { data: statusData, error: statusError, refresh: refreshStatus }] = await Promise.all([
  useFetch<ApiResponse<CapabilityResponse>>('/api/v1/system/capabilities'),
  useFetch<ApiResponse<ContextStatusResponse>>('/api/v1/system/context/status'),
])
const capability = computed(() => capabilityData.value?.data.openViking ?? statusData.value?.data.capability ?? null)
const contextProvider = computed(() => capabilityData.value?.data.contextProvider ?? 'sqlite_fts5')
const records = computed(() => statusData.value?.data.records ?? [])
const actionLoading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)
const reindexConfirmed = shallowRef(false)

/** @returns 主动检测外部上下文服务，不改变开关或索引。 */
async function checkProvider(): Promise<void> {
  await executeAction(async () => {
    const response = await $fetch<ApiResponse<{ healthy: boolean, version: string | null }>>('/api/v1/system/providers/check', {
      method: 'POST', body: { provider: 'openviking' },
    })
    actionMessage.value = `服务健康，版本 ${response.data.version ?? '未知'}`
  })
}

/** @returns 明确确认后从 SQLite 全量重建外部索引。 */
async function reindex(): Promise<void> {
  if (!reindexConfirmed.value) {
    actionError.value = '重建前必须勾选确认'
    return
  }
  await executeAction(async () => {
    const response = await $fetch<ApiResponse<ContextReindexResult>>('/api/v1/system/context/reindex', {
      method: 'POST', body: { provider: 'openviking', confirmed: true },
    })
    actionMessage.value = `重建完成：成功 ${response.data.synchronized}，失败 ${response.data.failed}`
    reindexConfirmed.value = false
  })
}

/** @param action 单次系统动作。 @returns 统一处理锁、错误和状态刷新。 */
async function executeAction(action: () => Promise<void>): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  actionError.value = null
  actionMessage.value = null
  try {
    await action()
    await Promise.all([refreshCapabilities(), refreshStatus()])
  }
  catch (error: unknown) {
    actionError.value = getApiErrorMessage(error, '上下文提供器操作失败')
  }
  finally {
    actionLoading.value = false
  }
}

/** @param timestamp UTC Unix 毫秒。 @returns 本地时间。 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <ContentPageHeader title="系统设置" description="能力开关和凭据由部署环境提供；浏览器只显示非敏感状态并执行显式检测或重建。" />
    <UAlert v-if="actionError" class="mb-5" color="error" title="操作失败" :description="actionError" />
    <UAlert v-if="actionMessage" class="mb-5" color="success" title="操作完成" :description="actionMessage" />
    <UAlert v-if="capabilityError || statusError" class="mb-5" color="error" title="系统能力加载失败" />

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <UCard>
        <template #header><h2 class="font-semibold text-highlighted">OpenViking 上下文索引</h2></template>
        <dl v-if="capability" class="grid gap-4 sm:grid-cols-2">
          <div><dt class="text-xs text-muted">已配置</dt><dd class="mt-1 font-medium">{{ capability.configured ? '是' : '否' }}</dd></div>
          <div><dt class="text-xs text-muted">已启用</dt><dd class="mt-1 font-medium">{{ capability.enabled ? '是' : '否' }}</dd></div>
          <div><dt class="text-xs text-muted">新运行提供器</dt><dd class="mt-1 font-medium">{{ contextProvider }}</dd></div>
          <div><dt class="text-xs text-muted">服务来源</dt><dd class="mt-1 break-all font-medium">{{ capability.endpointOrigin ?? '未配置' }}</dd></div>
        </dl>
        <UAlert class="mt-5" color="neutral" title="SQLite 始终是唯一业务事实源" description="关闭能力不会删除同步记录；远端索引可随时从 SQLite 资料完整重建。启用但不可用时，当前运行会明确失败，不会静默改用本地检索。" />
        <div class="mt-5 flex flex-wrap gap-2">
          <UButton :loading="actionLoading" color="neutral" variant="soft" @click="checkProvider">检测服务</UButton>
        </div>
        <div class="mt-6 border-t border-default pt-5">
          <UCheckbox v-model="reindexConfirmed" label="确认删除人样专属远端索引并从 SQLite 全量重建" />
          <UButton class="mt-3" :loading="actionLoading" color="warning" variant="soft" @click="reindex">全量重建索引</UButton>
        </div>
      </UCard>

      <UCard>
        <template #header><h2 class="font-semibold text-highlighted">同步记录</h2></template>
        <div v-if="records.length" class="space-y-3">
          <div v-for="record in records" :key="record.id" class="rounded-md border border-default p-3 text-sm">
            <div class="flex justify-between gap-2"><span class="break-all">{{ record.sourceId }}</span><UBadge :color="record.status === 'synchronized' ? 'success' : record.status === 'failed' ? 'error' : 'neutral'" variant="subtle">{{ record.status }}</UBadge></div>
            <p class="mt-2 break-all text-xs text-muted">{{ record.remoteUri ?? '尚无远端 URI' }}</p>
            <p v-if="record.error" class="mt-2 text-xs text-error">{{ record.error }}</p>
            <p class="mt-2 text-xs text-dimmed">{{ formatTime(record.updatedAt) }}</p>
          </div>
        </div>
        <p v-else class="py-6 text-center text-sm text-muted">尚无同步记录。</p>
      </UCard>
    </div>
  </div>
</template>
