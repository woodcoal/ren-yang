<script setup lang="ts">
import { shallowRef } from 'vue'

const props = defineProps<{
  /** 只在创建成功响应中存在的完整 API Key。 */
  secret: string
}>()

const emit = defineEmits<{
  /** 管理员确认保存后立即从页面状态移除明文。 */
  dismiss: []
}>()

const copied = shallowRef(false)

/**
 * 把本次创建返回的完整 Key 写入系统剪贴板。
 * @returns 剪贴板写入完成后结束的 Promise。
 * @remarks 只更新当前组件的已复制提示，不持久化明文。
 */
async function copySecret(): Promise<void> {
  await navigator.clipboard.writeText(props.secret)
  copied.value = true
}
</script>

<template>
  <UAlert color="warning" variant="soft" icon="i-lucide-triangle-alert" title="立即保存完整 API Key">
    <template #description>
      <p>关闭后无法再次查看；系统只保存不可逆摘要。</p>
      <code class="mt-3 block break-all rounded-lg bg-default px-3 py-3 text-sm text-highlighted">{{ props.secret }}</code>
      <div class="mt-3 flex flex-wrap gap-2">
        <UButton color="neutral" variant="soft" size="sm" icon="i-lucide-copy" @click="copySecret">{{ copied ? '已复制' : '复制 Key' }}</UButton>
        <UButton color="warning" variant="soft" size="sm" @click="emit('dismiss')">我已安全保存</UButton>
      </div>
    </template>
  </UAlert>
</template>
