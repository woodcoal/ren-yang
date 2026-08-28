<script setup lang="ts">
import type { SystemHealthResult } from '#shared/types/system'

/** 系统状态面板的只读属性。 */
interface Props {
  /** 服务端返回的非敏感健康状态。 */
  health: SystemHealthResult
}

defineProps<Props>()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-4">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            系统状态
          </h2>
          <p class="mt-1 text-sm text-muted">
            SQLite 与同进程 Worker 的实时摘要
          </p>
        </div>
        <UBadge :color="health.healthy ? 'success' : 'error'">
          {{ health.healthy ? '正常' : '异常' }}
        </UBadge>
      </div>
    </template>

    <dl class="grid gap-4 sm:grid-cols-2">
      <div class="rounded-lg bg-muted p-4">
        <dt class="text-sm text-muted">
          SQLite
        </dt>
        <dd class="mt-1 font-medium text-highlighted">
          {{ health.database.healthy ? '完整性正常' : '检查失败' }}
        </dd>
        <dd class="mt-1 text-xs text-muted">
          {{ health.database.journalMode.toUpperCase() }} · 外键{{ health.database.foreignKeysEnabled ? '已启用' : '未启用' }}
        </dd>
      </div>

      <div class="rounded-lg bg-muted p-4">
        <dt class="text-sm text-muted">
          内部 Worker
        </dt>
        <dd class="mt-1 font-medium text-highlighted">
          {{ health.worker.running ? '正在轮询' : '已停止' }}
        </dd>
        <dd class="mt-1 text-xs text-muted">
          {{ health.worker.lastError || '没有运行错误' }}
        </dd>
      </div>
    </dl>
  </UCard>
</template>
