<script setup lang="ts">
import { shallowRef } from 'vue'
import type { ApiKeyView } from '#shared/types/publicApi'

const props = defineProps<{
  /** 新记录在前且不包含摘要和明文的 API Key。 */
  keys: ApiKeyView[]
  /** 当前正在吊销的 Key 标识。 */
  revokingId: string | null
  /** 当前正在永久删除的 Key 标识。 */
  deletingId: string | null
}>()

const emit = defineEmits<{
  /** 明确确认后请求吊销指定 Key。 */
  revoke: [id: string]
  /** 明确确认后请求永久删除指定已吊销 Key。 */
  delete: [id: string]
}>()

const confirmingId = shallowRef<string | null>(null)
const deletingConfirmationId = shallowRef<string | null>(null)

/** 权限值到管理员可读名称的固定映射。 */
const scopeLabels: Record<ApiKeyView['scopes'][number], string> = {
  'persona:read': '人物读取',
  'persona:write': '人物写入',
  'world:read': '世界读取',
  'world:write': '世界写入',
  'library:read': '资料读取',
  'library:write': '资料写入',
  'generation:read': '兴趣与图文结果读取',
  'generation:write': '兴趣与图文创建及操作',
}

/**
 * 格式化 API Key 生命周期时间。
 * @param timestamp UTC Unix 毫秒数值或 null。
 * @param empty 时间缺失时显示的中文文案。
 * @returns 浏览器本地化时间或空值文案。
 */
function formatTime(timestamp: number | null, empty: string): string {
  return timestamp === null ? empty : new Date(timestamp).toLocaleString('zh-CN')
}

/**
 * 把 API Key 稳定状态转换为管理员可读文案。
 * @param key 不包含明文和摘要的 API Key 管理视图。
 * @returns 当前状态中文名。
 */
function statusLabel(key: ApiKeyView): string {
  if (key.status === 'revoked') return '已吊销'
  if (key.status === 'expired') return '已过期'
  return '有效'
}

/**
 * 确认吊销并把目标 Key 交给上层组件执行。
 * @param id 待吊销 API Key 的稳定 UUID。
 * @returns 无返回值；发出吊销事件并关闭确认状态。
 */
function confirmRevoke(id: string): void {
  confirmingId.value = null
  emit('revoke', id)
}

/**
 * 确认永久删除并把目标 Key 交给上层组件执行。
 * @param id 已吊销 API Key 的稳定 UUID。
 * @returns 无返回值；发出删除事件并关闭确认状态。
 */
function confirmDelete(id: string): void {
  deletingConfirmationId.value = null
  emit('delete', id)
}
</script>

<template>
  <UCard>
    <template #header>
      <div>
        <h2 class="font-semibold text-highlighted">现有 API Key</h2>
        <p class="mt-1 text-sm text-muted">只展示前缀和使用状态，完整 Key 无法恢复。</p>
      </div>
    </template>
    <div v-if="props.keys.length" class="divide-y divide-default">
      <article v-for="key in props.keys" :key="key.id" class="py-5 first:pt-0 last:pb-0">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="font-medium text-highlighted">{{ key.name }}</h3>
              <UBadge :color="key.status === 'active' ? 'success' : 'neutral'" variant="subtle">{{ statusLabel(key) }}</UBadge>
            </div>
            <code class="mt-2 block text-sm text-muted">{{ key.prefix }}…</code>
          </div>
          <UButton
            v-if="key.status === 'active' && confirmingId !== key.id"
            color="error"
            variant="soft"
            size="sm"
            @click="confirmingId = key.id"
          >吊销</UButton>
          <UButton
            v-if="key.status === 'revoked' && deletingConfirmationId !== key.id"
            color="error"
            variant="soft"
            size="sm"
            @click="deletingConfirmationId = key.id"
          >删除</UButton>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <UBadge v-for="scope in key.scopes" :key="scope" color="neutral" variant="outline">{{ scopeLabels[scope] }}</UBadge>
        </div>
        <dl class="mt-4 grid gap-2 text-xs text-muted sm:grid-cols-3">
          <div><dt>创建时间</dt><dd class="mt-1 text-highlighted">{{ formatTime(key.createdAt, '—') }}</dd></div>
          <div><dt>到期时间</dt><dd class="mt-1 text-highlighted">{{ formatTime(key.expiresAt, '永不过期') }}</dd></div>
          <div><dt>最近使用</dt><dd class="mt-1 text-highlighted">{{ formatTime(key.lastUsedAt, '尚未使用') }}</dd></div>
        </dl>
        <UAlert v-if="confirmingId === key.id" class="mt-4" color="error" variant="soft" title="吊销后下一次请求立即失败">
          <template #description>
            <div class="mt-2 flex gap-2">
              <UButton color="error" size="sm" :loading="props.revokingId === key.id" @click="confirmRevoke(key.id)">确认吊销</UButton>
              <UButton color="neutral" variant="soft" size="sm" @click="confirmingId = null">取消</UButton>
            </div>
          </template>
        </UAlert>
        <UAlert v-if="deletingConfirmationId === key.id" class="mt-4" color="error" variant="soft" title="永久删除后无法恢复">
          <template #description>
            <p>该 Key 的公共调用审计和幂等记录也会被删除。</p>
            <div class="mt-2 flex gap-2">
              <UButton color="error" size="sm" :loading="props.deletingId === key.id" @click="confirmDelete(key.id)">确认删除</UButton>
              <UButton color="neutral" variant="soft" size="sm" @click="deletingConfirmationId = null">取消</UButton>
            </div>
          </template>
        </UAlert>
      </article>
    </div>
    <p v-else class="py-8 text-center text-sm text-muted">尚未创建 API Key。</p>
  </UCard>
</template>
