<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { InterestBatchView } from '#shared/types/generation'
import { getApiErrorMessage } from '../../utils/apiError'

const route = useRoute()
const batchId = String(route.params.id)
const { notifyError, notifySuccess } = useOperationNotifications()
const { data, error, refresh } = await useFetch<ApiResponse<InterestBatchView>>(`/api/v1/interest-batches/${batchId}`)
const batch = computed(() => data.value?.data ?? null)
const active = computed(() => batch.value ? batch.value.status !== 'completed' : false)
const retryingItemId = shallowRef<string | null>(null)
const pollingTimer = shallowRef<ReturnType<typeof setInterval> | null>(null)

/**
 * 启动活动兴趣批次的两秒轮询；已有计时器或批次已完成时不重复启动。
 * @returns 无返回值。
 */
function startPolling(): void {
  if (pollingTimer.value || !active.value) return
  pollingTimer.value = setInterval(() => { void refresh() }, 2_000)
}

/**
 * 停止兴趣批次轮询并释放计时器。
 * @returns 无返回值。
 */
function stopPolling(): void {
  if (!pollingTimer.value) return
  clearInterval(pollingTimer.value)
  pollingTimer.value = null
}

/**
 * 只重新排队指定失败条目，并用服务端返回的完整批次替换当前视图。
 * @param itemId 批次内稳定条目标识。
 * @returns 重试请求完成时结束。
 */
async function retryItem(itemId: string): Promise<void> {
  if (retryingItemId.value) return
  retryingItemId.value = itemId
  try {
    const response = await $fetch<ApiResponse<InterestBatchView>>(
      `/api/v1/interest-batches/${batchId}/items/${encodeURIComponent(itemId)}/retry`,
      { method: 'POST' },
    )
    data.value = response
    notifySuccess('失败条目已单独重新排队，其他结果不会重跑。', '单项重试已创建')
    startPolling()
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, '兴趣条目重试失败'), '重试失败')
  }
  finally {
    retryingItemId.value = null
  }
}

/**
 * 格式化批次时间为浏览器本地中文日期时间。
 * @param timestamp UTC Unix 毫秒。
 * @returns 本地日期时间文本。
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

watch(active, value => value ? startPolling() : stopPolling())
onMounted(startPolling)
onUnmounted(stopPolling)
</script>

<template>
  <div>
    <ContentPageHeader title="兴趣批次详情" description="一次模型调用完成整批判断；每条结果独立保存，失败项可以单独重试。">
      <UButton to="/history" color="neutral" variant="ghost" icon="i-lucide-history">返回任务记录</UButton>
    </ContentPageHeader>

    <UAlert v-if="error" color="error" title="兴趣批次加载失败" :actions="[{ label: '重试', onClick: () => { void refresh() } }]" />
    <template v-else-if="batch">
      <UCard class="mb-6">
        <div class="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <p><span class="text-muted">人物：</span><NuxtLink :to="`/personas/${batch.personaId}`" class="font-medium text-primary">{{ batch.personaName }}</NuxtLink></p>
          <p><span class="text-muted">条目：</span>{{ batch.items.length }} 条</p>
          <p><span class="text-muted">创建：</span>{{ formatTime(batch.createdAt) }}</p>
          <p><span class="text-muted">批次：</span><code>{{ batch.batchId }}</code></p>
        </div>
        <p v-if="batch.additionalPrompt" class="mt-4 rounded-md bg-elevated px-3 py-2 text-sm"><span class="text-muted">附加提示词：</span>{{ batch.additionalPrompt }}</p>
      </UCard>

      <GenerationInterestBatchResultList
        :items="batch.items"
        :retrying-item-id="retryingItemId"
        @retry="retryItem"
      />
    </template>
  </div>
</template>
