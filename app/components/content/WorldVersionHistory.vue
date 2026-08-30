<script setup lang="ts">
import { shallowRef } from 'vue'
import type { WorldVersionView } from '#shared/types/content'

/** 世界修改记录组件属性。 */
interface Props {
  /** 按创建时间倒序排列的世界版本。 */
  versions: WorldVersionView[]
  /** 当前用于新任务的世界版本 UUID；尚未发布时为 null。 */
  activeVersionId: string | null
  /** 页面是否正在执行写操作。 */
  loading: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  /** 请求发布一份待确认修改稿。 */
  publish: [versionId: string]
  /** 请求恢复使用一个历史已发布版本。 */
  activate: [versionId: string]
  /** 用户二次确认后请求永久删除一个版本。 */
  delete: [versionId: string]
}>()

/** 当前等待二次确认删除的版本 UUID。 */
const pendingDeletionId = shallowRef<string | null>(null)
/** 用户是否已经勾选永久删除确认项。 */
const deletionConfirmed = shallowRef(false)

/**
 * 打开指定版本的删除确认区，重复点击会关闭确认区。
 * @param versionId 待删除世界版本 UUID。
 * @returns 无返回值。
 */
function toggleDeletion(versionId: string): void {
  pendingDeletionId.value = pendingDeletionId.value === versionId ? null : versionId
  deletionConfirmed.value = false
}

/**
 * 提交已经二次确认的永久删除请求并关闭确认区。
 * @param versionId 待删除世界版本 UUID。
 * @returns 无返回值。
 */
function confirmDeletion(versionId: string): void {
  if (!deletionConfirmed.value || pendingDeletionId.value !== versionId) return
  emit('delete', versionId)
  pendingDeletionId.value = null
  deletionConfirmed.value = false
}

/**
 * 把完整 UUID 缩短为便于人工区分的末八位。
 * @param versionId 完整世界版本 UUID。
 * @returns 版本短编号。
 */
function shortVersionId(versionId: string): string {
  return versionId.slice(-8)
}

/**
 * 把 UTC Unix 毫秒转换为当前浏览器的中文日期时间。
 * @param timestamp UTC Unix 毫秒。
 * @returns 本地化日期时间文本。
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <div class="flex items-center gap-2">
          <h2 class="font-semibold text-highlighted">修改记录</h2>
          <UBadge color="neutral" variant="subtle">{{ props.versions.length }} 条</UBadge>
        </div>
        <p class="mt-1 text-sm text-muted">每次修改都会单独保存。只有标记为“正在使用”的版本会用于人物的新任务。</p>
      </div>
    </template>

    <div class="max-h-[44rem] space-y-3 overflow-y-auto pr-1">
      <article v-for="version in props.versions" :key="version.id" class="rounded-lg border border-default p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge :color="version.status === 'published' ? 'success' : 'warning'" variant="subtle">
                {{ version.status === 'published' ? '已发布' : '待确认修改稿' }}
              </UBadge>
              <UBadge v-if="version.id === props.activeVersionId" color="primary">正在使用</UBadge>
              <span class="text-xs text-muted">编号 {{ shortVersionId(version.id) }}</span>
            </div>
            <p class="mt-2 font-medium text-highlighted">{{ version.changeSummary }}</p>
            <p class="mt-1 text-xs text-muted">保存于 {{ formatTime(version.createdAt) }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton v-if="version.id !== props.activeVersionId" size="sm" color="neutral" variant="soft" :loading="props.loading" @click="emit('activate', version.id)">恢复使用此版</UButton>
            <UButton v-if="version.id !== props.activeVersionId" size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" aria-label="删除" :loading="props.loading" @click="toggleDeletion(version.id)">删除</UButton>
          </div>
        </div>

        <details class="mt-3 rounded-md bg-elevated px-3 py-2">
          <summary class="cursor-pointer text-sm font-medium text-muted">查看这一版的完整设定</summary>
          <pre class="content-pre mt-3 max-h-80 overflow-y-auto">{{ version.snapshot.promptText }}</pre>
        </details>

        <div v-if="pendingDeletionId === version.id" class="mt-3 space-y-3 rounded-md border border-error/30 bg-error/5 p-3 text-sm">
          <p>删除后无法恢复。当前使用版、仍有后续修改或已被历史任务使用的版本，服务端会拒绝删除。</p>
          <UCheckbox v-model="deletionConfirmed" label="我确认这是一条错误记录，需要永久删除" />
          <div class="flex gap-2">
            <UButton color="error" size="sm" :disabled="!deletionConfirmed" :loading="props.loading" @click="confirmDeletion(version.id)">永久删除</UButton>
            <UButton color="neutral" variant="ghost" size="sm" @click="toggleDeletion(version.id)">取消</UButton>
          </div>
        </div>
      </article>
    </div>
  </UCard>
</template>
