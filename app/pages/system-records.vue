<script setup lang="ts">
import { computed } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { ContextSyncRecordPageView, ContextSyncRecordView } from '#shared/types/context'
import type { AuditEventPageView, AuditEventView } from '#shared/types/system'
import { getApiErrorMessage } from '../utils/apiError'

const route = useRoute()

/** 系统记录页面支持的记录类型。 */
type SystemRecordType = 'sync' | 'audit'
/** 系统记录页面支持的每页数量。 */
type SystemRecordPageSize = 5 | 10 | 20 | 50 | 100

/** @param value 查询参数原值。 @param fallback 无效时的默认值。 @returns 正整数。 */
function readPositiveInteger(value: unknown, fallback: number): number {
  const normalized = Array.isArray(value) ? value[0] : value
  const parsed = Number(normalized)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** @param value 查询参数原值。 @returns 支持的每页数量，无效时回退为 10。 */
function readPageSize(value: unknown): SystemRecordPageSize {
  const parsed = readPositiveInteger(value, 10)
  return parsed === 5 || parsed === 20 || parsed === 50 || parsed === 100 ? parsed : 10
}

/** @param value 查询参数原值。 @returns 支持的记录类型，无效时默认返回同步日志。 */
function readRecordType(value: unknown): SystemRecordType {
  const normalized = Array.isArray(value) ? value[0] : value
  return normalized === 'audit' ? 'audit' : 'sync'
}

const recordType = computed(() => readRecordType(route.query.type))
const requestedPage = computed(() => readPositiveInteger(route.query.page, 1))
const requestedPageSize = computed(() => readPageSize(route.query.pageSize))
const recordsEndpoint = computed(() => recordType.value === 'audit'
  ? '/api/v1/system/audit/page'
  : '/api/v1/system/context/records')
const recordsQuery = computed(() => ({ page: requestedPage.value, pageSize: requestedPageSize.value }))
const { data, error, refresh } = await useFetch<ApiResponse<AuditEventPageView | ContextSyncRecordPageView>>(
  recordsEndpoint,
  { query: recordsQuery },
)
const recordPage = computed(() => data.value?.data ?? {
  items: [], total: 0, page: requestedPage.value, pageSize: requestedPageSize.value, totalPages: 1,
})
const auditEvents = computed(() => recordType.value === 'audit' ? recordPage.value.items as AuditEventView[] : [])
const syncRecords = computed(() => recordType.value === 'sync' ? recordPage.value.items as ContextSyncRecordView[] : [])
const retryingSourceId = shallowRef<string | null>(null)
const { notifySuccess, notifyError } = useOperationNotifications()

/** 可选择的每页记录数量。 */
const pageSizeItems = [
  { label: '每页 5 条', value: 5 }, { label: '每页 10 条', value: 10 }, { label: '每页 20 条', value: 20 },
  { label: '每页 50 条', value: 50 }, { label: '每页 100 条', value: 100 },
]

/** 审计动作中文标签；未知动作保留稳定名称，避免隐藏新事件。 */
const auditActionLabels: Record<string, string> = {
  administrator_created: '创建管理员', administrator_password_reset: '重置管理员密码',
  data_restored: '恢复数据', context_reindexed: '重建上下文索引',
}

/** @param type 新记录类型。 @returns 切换类型并回到第一页的导航完成时结束。 */
async function changeRecordType(type: SystemRecordType): Promise<void> {
  if (type === recordType.value) return
  await navigateTo({ path: route.path, query: { type, page: '1', pageSize: String(recordPage.value.pageSize) } })
}

/** @param page 新页码。 @param pageSize 新每页数量。 @returns 分页 URL 更新完成时结束。 */
async function updatePagination(page: number, pageSize: SystemRecordPageSize): Promise<void> {
  await navigateTo({
    path: route.path,
    query: { type: recordType.value, page: String(page), pageSize: String(pageSize) },
  })
}

/** @param page 新页码。 @returns 分页 URL 更新完成时结束。 */
async function changePage(page: number): Promise<void> {
  await updatePagination(page, recordPage.value.pageSize)
}

/** @param pageSize 新每页数量。 @returns 回到第一页的分页 URL 更新完成时结束。 */
async function changePageSize(pageSize: number): Promise<void> {
  await updatePagination(1, readPageSize(pageSize))
}

/** @param timestamp UTC Unix 毫秒。 @returns 本地日期时间。 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN')
}

/** @param event 审计记录。 @returns 中文动作名称或稳定动作名称。 */
function auditActionLabel(event: AuditEventView): string {
  return auditActionLabels[event.action] ?? event.action
}

/** @param actor 审计主体。 @returns 中文主体名称。 */
function auditActorLabel(actor: AuditEventView['actor']): string {
  return actor === 'administrator' ? '管理员' : actor === 'maintenance' ? '本机维护' : '系统'
}

/** @param record 同步日志。 @returns 中文实体类型。 */
function entityTypeLabel(record: ContextSyncRecordView): string {
  const labels: Record<ContextSyncRecordView['entityType'], string> = {
    source_material: '参考资料', persona_feedback_source: '人物反馈资料', growth: '成长记录', memory: '记忆记录',
  }
  return labels[record.entityType]
}

/** @param record 同步日志。 @returns 中文范围说明。 */
function scopeLabel(record: ContextSyncRecordView): string {
  const scopeName = record.scopeType === 'world' ? '世界' : record.scopeType === 'persona' ? '人物' : '全局'
  return `${scopeName} · ${record.scopeId}`
}

/** @param record 同步日志。 @returns 中文同步状态。 */
function syncStatusLabel(record: ContextSyncRecordView): string {
  if (record.status === 'synchronized') return '已同步'
  if (record.status === 'pending') return '同步中'
  return record.nextRetryAt === null ? '需要处理' : '等待自动重试'
}

/** @param record 失败投影。 @returns 重新安排同一资料全部投影后刷新列表。 */
async function retrySyncRecord(record: ContextSyncRecordView): Promise<void> {
  if (retryingSourceId.value) return
  retryingSourceId.value = record.sourceId
  try {
    const response = await $fetch<ApiResponse<{ enqueued: number }>>('/api/v1/system/context/retry', {
      method: 'POST',
      body: { scope: 'entity', entityType: record.entityType, sourceId: record.sourceId },
    })
    notifySuccess(`已重新安排 ${response.data.enqueued} 项资料`, '同步重试已安排')
    await refresh()
  }
  catch (error: unknown) {
    notifyError(getApiErrorMessage(error, '重新安排同步失败'))
  }
  finally {
    retryingSourceId.value = null
  }
}

/** @param record 同步日志。 @returns 状态徽标颜色。 */
function syncStatusColor(record: ContextSyncRecordView): 'success' | 'error' | 'neutral' {
  return record.status === 'synchronized' ? 'success' : record.status === 'failed' ? 'error' : 'neutral'
}
</script>

<template>
  <div>
    <ContentPageHeader title="日志与审计" description="分页查看 OpenViking 同步事实与关键管理动作；不展示正文、凭据或模型内容。">
      <UButton to="/settings" color="neutral" variant="soft" icon="i-lucide-settings-2">返回系统中心</UButton>
    </ContentPageHeader>

    <UAlert v-if="error" class="mb-5" color="error" title="系统记录加载失败"
      :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <section v-else class="content-section" aria-labelledby="system-record-list-heading">
      <h2 id="system-record-list-heading" class="visually-hidden">系统记录列表</h2>
      <div class="list-management-panel">
        <div class="list-management-controls">
          <div class="flex flex-wrap gap-2" aria-label="系统记录类型">
            <UButton color="neutral" :variant="recordType === 'sync' ? 'solid' : 'ghost'"
              :aria-pressed="recordType === 'sync'" icon="i-lucide-refresh-cw" @click="changeRecordType('sync')">同步日志</UButton>
            <UButton color="neutral" :variant="recordType === 'audit' ? 'solid' : 'ghost'"
              :aria-pressed="recordType === 'audit'" icon="i-lucide-shield-check" @click="changeRecordType('audit')">审计记录</UButton>
          </div>
          <p class="m-0 text-sm text-muted">{{ recordType === 'sync' ? 'OpenViking 投影同步状态' : '关键管理动作留痕' }}</p>
        </div>

        <template v-if="recordType === 'sync' && syncRecords.length">
          <div class="content-table-wrap list-management-table">
            <table class="content-table">
              <thead><tr><th>对象</th><th>范围</th><th>操作与状态</th><th>远端位置或错误</th><th>更新时间</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="record in syncRecords" :key="record.id">
                  <td data-label="对象"><strong class="content-table-title">{{ entityTypeLabel(record) }}</strong><span class="content-table-description break-all">{{ record.sourceId }}</span></td>
                  <td data-label="范围"><span class="content-table-title">{{ scopeLabel(record) }}</span><span class="content-table-description break-all">{{ record.userId }}</span></td>
                  <td data-label="操作与状态"><span class="content-table-title">{{ record.operation === 'upsert' ? '写入或更新' : '删除' }}</span><UBadge class="mt-1" :color="syncStatusColor(record)" variant="subtle">{{ syncStatusLabel(record) }}</UBadge></td>
                  <td data-label="远端位置或错误"><span :class="record.error ? 'text-error' : 'text-muted'" class="break-all">{{ record.error ?? record.remoteUri ?? '尚无远端 URI' }}</span><span v-if="record.errorCode || record.errorStage" class="content-table-description">{{ [record.errorStage, record.errorCode].filter(Boolean).join(' · ') }}</span></td>
                  <td data-label="更新时间"><span class="whitespace-nowrap">{{ formatTime(record.updatedAt) }}</span><span v-if="record.nextRetryAt" class="content-table-description whitespace-nowrap">下次重试 {{ formatTime(record.nextRetryAt) }}</span></td>
                  <td data-label="操作"><UButton v-if="record.status === 'failed'" size="xs" color="neutral" variant="soft" icon="i-lucide-refresh-cw" :loading="retryingSourceId === record.sourceId" :disabled="Boolean(retryingSourceId)" @click="retrySyncRecord(record)">重新同步</UButton><span v-else class="text-muted">—</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <template v-else-if="recordType === 'audit' && auditEvents.length">
          <div class="content-table-wrap list-management-table">
            <table class="content-table">
              <thead><tr><th>动作</th><th>主体</th><th>资源类型</th><th>资源标识</th><th>时间</th></tr></thead>
              <tbody>
                <tr v-for="event in auditEvents" :key="event.id">
                  <td data-label="动作"><strong class="content-table-title">{{ auditActionLabel(event) }}</strong><span class="content-table-description">{{ event.action }}</span></td>
                  <td data-label="主体"><UBadge color="neutral" variant="subtle">{{ auditActorLabel(event.actor) }}</UBadge></td>
                  <td data-label="资源类型"><span class="content-table-title">{{ event.targetType }}</span></td>
                  <td data-label="资源标识"><span class="break-all text-muted">{{ event.targetId ?? '全局动作' }}</span></td>
                  <td data-label="时间"><span class="whitespace-nowrap">{{ formatTime(event.createdAt) }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <div v-else class="content-empty-state list-management-empty">
          <div><strong>{{ recordType === 'sync' ? '尚无同步日志' : '尚无审计记录' }}</strong><p class="mt-1 text-sm text-muted">{{ recordType === 'sync' ? '发生 OpenViking 投影同步后会在这里显示。' : '执行关键管理动作后会在这里显示。' }}</p></div>
        </div>

        <div v-if="recordPage.total > 0" class="list-management-footer">
          <p class="m-0 text-sm text-muted">第 {{ recordPage.page }} / {{ recordPage.totalPages }} 页，共 {{ recordPage.total }} 项</p>
          <div class="list-management-pagination">
            <USelect :model-value="recordPage.pageSize" class="w-34" :items="pageSizeItems"
              :aria-label="recordType === 'sync' ? '每页同步日志数量' : '每页审计记录数量'" @update:model-value="changePageSize" />
            <UPagination :page="recordPage.page" :total="recordPage.total" :items-per-page="recordPage.pageSize"
              show-edges @update:page="changePage" />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
