<script setup lang="ts">
import { shallowRef } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { BackupSummary } from '#shared/types/backup'
import { getApiErrorMessage } from '../../utils/apiError'

const loading = shallowRef(false)
const errorMessage = shallowRef<string | null>(null)
const created = shallowRef<BackupSummary | null>(null)

/** @returns 在线创建一致性备份并显示安全摘要。 */
async function createBackup(): Promise<void> {
  if (loading.value) return
  loading.value = true
  errorMessage.value = null
  try {
    const response = await $fetch<ApiResponse<BackupSummary>>('/api/v1/system/backups', { method: 'POST' })
    created.value = response.data
  }
  catch (error: unknown) {
    errorMessage.value = getApiErrorMessage(error, '备份创建失败')
  }
  finally {
    loading.value = false
  }
}

/** @param bytes 原始字节数。 @returns 便于阅读的容量。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="font-semibold text-highlighted">数据备份</h2>
        <p class="mt-1 text-sm text-muted">创建 SQLite、资料原文件和图片资产的一致性备份；不包含密钥、日志或 OpenViking 索引。</p>
      </div>
    </template>
    <UAlert v-if="errorMessage" class="mb-4" color="error" title="备份失败" :description="errorMessage" />
    <UAlert
      v-if="created"
      class="mb-4"
      color="success"
      title="备份创建完成"
      :description="`${created.backupId} · ${created.fileCount} 个文件 · ${formatBytes(created.totalBytes)}`"
    />
    <p class="mb-4 text-sm text-muted">恢复必须先停止应用，再使用 <code>pnpm restore:validate</code> 和 <code>pnpm restore</code> 本机命令执行。</p>
    <UButton :loading="loading" icon="i-lucide-archive" @click="createBackup">创建一致性备份</UButton>
  </UCard>
</template>
