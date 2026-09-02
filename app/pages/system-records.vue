<script setup lang="ts">
import { computed } from 'vue'
import type { ApiResponse } from '#shared/types/api'
import type { OpenVikingTaskView } from '#shared/types/context'
import type { AuditEventPageView, AuditEventView } from '#shared/types/system'

const route = useRoute()

/** 系统记录页面支持的记录类型。 */
type SystemRecordType = 'openviking' | 'audit'
/** 审计记录页面支持的每页数量。 */
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

/** @param value 查询参数原值。 @returns 支持的记录类型，无效时默认返回 OpenViking 日志。 */
function readRecordType(value: unknown): SystemRecordType {
  const normalized = Array.isArray(value) ? value[0] : value
  return normalized === 'audit' ? 'audit' : 'openviking'
}

const recordType = computed(() => readRecordType(route.query.type))
const requestedPage = computed(() => readPositiveInteger(route.query.page, 1))
const requestedPageSize = computed(() => readPageSize(route.query.pageSize))
const auditQuery = computed(() => ({ page: requestedPage.value, pageSize: requestedPageSize.value }))
const [
  { data: taskData, error: taskError, refresh: refreshTasks },
  { data: auditData, error: auditError, refresh: refreshAudit },
] = await Promise.all([
  useFetch<ApiResponse<OpenVikingTaskView[]>>('/api/v1/system/context/tasks', { query: { limit: 50 } }),
  useFetch<ApiResponse<AuditEventPageView>>('/api/v1/system/audit/page', { query: auditQuery }),
])
const openVikingTasks = computed(() => taskData.value?.data ?? [])
const auditPage = computed<AuditEventPageView>(() => auditData.value?.data ?? {
  items: [], total: 0, page: requestedPage.value, pageSize: requestedPageSize.value, totalPages: 1,
})
const auditEvents = computed(() => auditPage.value.items)
const currentError = computed(() => recordType.value === 'openviking' ? taskError.value : auditError.value)

/** 可选择的每页审计记录数量。 */
const pageSizeItems = [
  { label: '每页 5 条', value: 5 }, { label: '每页 10 条', value: 10 }, { label: '每页 20 条', value: 20 },
  { label: '每页 50 条', value: 50 }, { label: '每页 100 条', value: 100 },
]

/** 审计动作中文标签；未知动作保留稳定名称，避免隐藏新事件。 */
const auditActionLabels: Record<string, string> = {
  administrator_created: '创建管理员', administrator_password_changed: '修改管理员密码',
  administrator_password_reset: '重置管理员密码',
  data_restored: '恢复数据', context_reindexed: '重建上下文索引',
}

/** OpenViking 官方任务状态中文标签。 */
const openVikingStatusLabels: Record<OpenVikingTaskView['status'], string> = {
  pending: '等待处理', running: '执行中', cancelling: '取消中', completed: '已完成', failed: '失败', cancelled: '已取消',
}

/** @param type 新记录类型。 @returns 切换类型并回到第一页的导航完成时结束。 */
async function changeRecordType(type: SystemRecordType): Promise<void> {
  if (type === recordType.value) return
  await navigateTo({ path: route.path, query: { type, page: '1', pageSize: String(auditPage.value.pageSize) } })
}

/** @param page 新页码。 @param pageSize 新每页数量。 @returns 审计分页 URL 更新完成时结束。 */
async function updatePagination(page: number, pageSize: SystemRecordPageSize): Promise<void> {
  await navigateTo({
    path: route.path,
    query: { type: 'audit', page: String(page), pageSize: String(pageSize) },
  })
}

/** @param page 新页码。 @returns 审计分页导航完成时结束。 */
async function changePage(page: number): Promise<void> {
  await updatePagination(page, auditPage.value.pageSize)
}

/** @param pageSize 新每页数量。 @returns 审计分页回到第一页时结束。 */
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

/** @param status OpenViking 官方任务状态。 @returns Nuxt UI 徽标颜色。 */
function openVikingStatusColor(status: OpenVikingTaskView['status']): 'success' | 'error' | 'warning' | 'neutral' {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'cancelling') return 'warning'
  return 'neutral'
}

/** @returns 刷新当前选中的记录类型。 */
async function refreshCurrent(): Promise<void> {
  if (recordType.value === 'openviking') await refreshTasks()
  else await refreshAudit()
}
</script>

<template>
  <div>
    <ContentPageHeader title="日志与审计" description="OpenViking 操作直接读取其官方任务日志；本系统只保留关键管理动作审计。">
      <UButton to="/settings" color="neutral" variant="soft" icon="i-lucide-settings-2">返回系统中心</UButton>
    </ContentPageHeader>

    <UAlert v-if="currentError" class="mb-5" color="error" title="系统记录加载失败"
      :actions="[{ label: '重试', onClick: refreshCurrent }]" />
    <section v-else class="content-section" aria-labelledby="system-record-list-heading">
      <h2 id="system-record-list-heading" class="visually-hidden">系统记录列表</h2>
      <div class="list-management-panel">
        <div class="list-management-controls">
          <div class="flex flex-wrap gap-2" aria-label="系统记录类型">
            <UButton color="neutral" :variant="recordType === 'openviking' ? 'solid' : 'ghost'"
              :aria-pressed="recordType === 'openviking'" icon="i-lucide-refresh-cw" @click="changeRecordType('openviking')">OpenViking 任务</UButton>
            <UButton color="neutral" :variant="recordType === 'audit' ? 'solid' : 'ghost'"
              :aria-pressed="recordType === 'audit'" icon="i-lucide-shield-check" @click="changeRecordType('audit')">审计记录</UButton>
          </div>
          <p class="m-0 text-sm text-muted">{{ recordType === 'openviking' ? '最新 50 条 OpenViking 官方任务日志' : '关键管理动作留痕' }}</p>
        </div>

        <template v-if="recordType === 'openviking' && openVikingTasks.length">
          <div class="content-table-wrap list-management-table">
            <table class="content-table">
              <thead><tr><th>任务</th><th>User</th><th>状态</th><th>资源与阶段</th><th>更新时间</th></tr></thead>
              <tbody>
                <tr v-for="task in openVikingTasks" :key="`${task.ownerUserId}:${task.taskId}`">
                  <td data-label="任务"><strong class="content-table-title">{{ task.taskType }}</strong><span class="content-table-description break-all">{{ task.taskId }}</span></td>
                  <td data-label="User"><span class="break-all">{{ task.ownerUserId }}</span></td>
                  <td data-label="状态"><UBadge :color="openVikingStatusColor(task.status)" variant="subtle">{{ openVikingStatusLabels[task.status] }}</UBadge><span v-if="task.error" class="content-table-description text-error">{{ task.error }}</span></td>
                  <td data-label="资源与阶段"><span class="break-all">{{ task.resourceId ?? '—' }}</span><span v-if="task.stage" class="content-table-description">{{ task.stage }}</span></td>
                  <td data-label="更新时间"><span class="whitespace-nowrap">{{ formatTime(task.updatedAt) }}</span><span class="content-table-description whitespace-nowrap">创建 {{ formatTime(task.createdAt) }}</span></td>
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
          <div><strong>{{ recordType === 'openviking' ? '尚无 OpenViking 任务日志' : '尚无审计记录' }}</strong><p class="mt-1 text-sm text-muted">{{ recordType === 'openviking' ? '记录由 OpenViking 自身保存和管理。' : '执行关键管理动作后会在这里显示。' }}</p></div>
        </div>

        <div v-if="recordType === 'audit' && auditPage.total > 0" class="list-management-footer">
          <p class="m-0 text-sm text-muted">第 {{ auditPage.page }} / {{ auditPage.totalPages }} 页，共 {{ auditPage.total }} 项</p>
          <div class="list-management-pagination">
            <USelect :model-value="auditPage.pageSize" class="w-34" :items="pageSizeItems"
              aria-label="每页审计记录数量" @update:model-value="changePageSize" />
            <UPagination :page="auditPage.page" :total="auditPage.total" :items-per-page="auditPage.pageSize"
              show-edges @update:page="changePage" />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
