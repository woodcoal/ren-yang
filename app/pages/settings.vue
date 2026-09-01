<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ApiResponse, AuthenticationSessionResult } from '#shared/types/api'
import type { UpdateOpenVikingSettingsInput } from '#shared/schemas/context'
import type { ContextReindexResult, ContextSyncSummaryView, OpenVikingCapabilityView, OpenVikingSettingsView } from '#shared/types/context'
import type { SystemCapabilitiesResult } from '#shared/types/system'
import { getApiErrorMessage } from '../utils/apiError'

/** 上下文同步状态接口。 */
interface ContextStatusResponse extends ContextSyncSummaryView {
  capability: OpenVikingCapabilityView
}

const [
  { data: capabilityData, error: capabilityError, refresh: refreshCapabilities },
  { data: statusData, error: statusError, refresh: refreshStatus },
  { data: sessionData, error: sessionError },
  { data: openVikingSettingsData, error: openVikingSettingsError, refresh: refreshOpenVikingSettings },
] = await Promise.all([
  useFetch<ApiResponse<SystemCapabilitiesResult>>('/api/v1/system/capabilities'),
  useFetch<ApiResponse<ContextStatusResponse>>('/api/v1/system/context/summary'),
  useFetch<ApiResponse<AuthenticationSessionResult>>('/api/v1/auth/session'),
  useFetch<ApiResponse<OpenVikingSettingsView>>('/api/v1/system/context/settings'),
])
const capabilities = computed(() => capabilityData.value?.data ?? null)
const capability = computed(() => capabilityData.value?.data.openViking ?? statusData.value?.data.capability ?? null)
const contextProvider = computed(() => capabilityData.value?.data.contextProvider ?? 'sqlite_fts5')
const administrator = computed(() => sessionData.value?.data.administrator ?? null)
const openVikingSettings = computed(() => openVikingSettingsData.value?.data ?? null)
const failedSyncCount = computed(() => statusData.value?.data.failedCount ?? 0)

const syncRuntime = computed(() => statusData.value?.data.runtime ?? null)
const { notifySuccess, notifyError, notifyWarning } = useOperationNotifications()
const actionLoading = shallowRef(false)
const reindexConfirmed = shallowRef(false)

/** @returns 主动检测外部上下文服务，不改变开关或索引。 */
async function checkProvider(): Promise<void> {
  await executeAction(async () => {
    const response = await $fetch<ApiResponse<{ healthy: boolean, version: string | null, authMode: 'api_key' }>>('/api/v1/system/providers/check', {
      method: 'POST', body: { provider: 'openviking' },
    })
    notifySuccess(`服务正常，版本 ${response.data.version ?? '未知'}，ADMIN Key 可管理隔离 User`, 'OpenViking 检测通过')
  })
}

/**
 * 加密保存 OpenViking 设置；启用时立即验证健康状态和 ADMIN User 管理权限。
 * @param input 已通过共享 Schema 校验的设置。
 * @returns 保存、检测和状态刷新结束时完成。
 */
async function saveOpenVikingSettings(input: UpdateOpenVikingSettingsInput): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    const response = await $fetch<ApiResponse<OpenVikingSettingsView>>('/api/v1/system/context/settings', {
      method: 'PUT', body: input,
    })
    openVikingSettingsData.value = response
    if (response.data.enabled) {
      try {
        const checked = await $fetch<ApiResponse<{ healthy: boolean, version: string | null, authMode: 'api_key' }>>('/api/v1/system/providers/check', {
          method: 'POST', body: { provider: 'openviking' },
        })
        notifySuccess(`设置已保存并立即生效；服务版本 ${checked.data.version ?? '未知'}，ADMIN Key 具有 User 管理权限`, 'OpenViking 设置已保存')
      }
      catch (error: unknown) {
        notifyWarning(`设置已保存，但服务或 ADMIN 权限检测失败：${getApiErrorMessage(error, '检测失败')}`, 'OpenViking 检测未通过')
      }
    }
    else {
      notifySuccess('设置已保存；新任务已切换为 SQLite 本地检索', 'OpenViking 设置已保存')
    }
    await Promise.all([refreshCapabilities(), refreshStatus(), refreshOpenVikingSettings()])
  }
  catch (error: unknown) {
    notifyError(getApiErrorMessage(error, 'OpenViking 设置保存失败'), 'OpenViking 设置保存失败')
  }
  finally {
    actionLoading.value = false
  }
}

/** @returns 明确确认后从 SQLite 全量重建外部索引。 */
async function reindex(): Promise<void> {
  if (!reindexConfirmed.value) {
    notifyError('重建前必须勾选确认', '未执行索引重建')
    return
  }
  await executeAction(async () => {
    const response = await $fetch<ApiResponse<ContextReindexResult>>('/api/v1/system/context/reindex', {
      method: 'POST', body: { provider: 'openviking', confirmed: true },
    })
    const result = `成功 ${response.data.synchronized}，失败 ${response.data.failed}`
    if (response.data.failed > 0) notifyWarning(result, '索引重建部分完成')
    else notifySuccess(result, '索引重建完成')
    reindexConfirmed.value = false
  })
}

/** @returns 把全部需要处理的失败资料重新安排到持久队列。 */
async function retryAllFailed(): Promise<void> {
  await executeAction(async () => {
    const response = await $fetch<ApiResponse<{ enqueued: number }>>('/api/v1/system/context/retry', {
      method: 'POST', body: { scope: 'all' },
    })
    notifySuccess(`已重新安排 ${response.data.enqueued} 项资料；队列健康后会自动继续`, 'OpenViking 重试已安排')
  })
}

/** @param action 单次系统动作。 @returns 统一处理锁、错误和状态刷新。 */
async function executeAction(action: () => Promise<void>): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    await action()
    await Promise.all([refreshCapabilities(), refreshStatus()])
  }
  catch (error: unknown) {
    notifyError(getApiErrorMessage(error, '上下文提供器操作失败'))
  }
  finally {
    actionLoading.value = false
  }
}

</script>

<template>
  <div>
    <ContentPageHeader title="系统中心" description="按能力、检索同步和备份分区检查系统；浏览器只显示可确认的非敏感状态。" />

    <UAlert v-if="capabilityError || statusError || sessionError || openVikingSettingsError" class="mb-5" color="error"
      title="系统数据加载失败" />

    <div class="mt-8 mb-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.6fr)]">
      <SystemCapabilityStatusPanel v-if="capabilities" :capabilities="capabilities" show-limits />
      <UAlert v-else color="error" title="能力状态不可用" description="无法安全展示模型能力和系统默认运行限制。" />
      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">账户安全</h2>
        </template>
        <dl v-if="administrator" class="space-y-3 text-sm">
          <div>
            <dt class="text-muted">当前管理员</dt>
            <dd class="mt-1 font-medium text-highlighted">{{ administrator.username }}</dd>
          </div>
          <div>
            <dt class="text-muted">账户范围</dt>
            <dd class="mt-1">本机唯一管理员</dd>
          </div>
        </dl>
        <UAlert class="mt-5" color="neutral" title="密码不在浏览器内维护" description="忘记密码时停止应用并执行本机维护命令；重置会撤销既有会话并写入审计。" />
      </UCard>
    </div>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section class="archive-panel" aria-labelledby="openviking-settings-heading">
        <div class="section-heading">
          <div class="section-heading-copy">
            <p class="eyebrow">检索与同步</p>
            <h2 id="openviking-settings-heading">OpenViking 上下文索引</h2>
            <p>SQLite 保存业务事实，OpenViking 只承担按世界和人物隔离的上下文增强。</p>
          </div>
        </div>
        <dl v-if="capability" class="grid gap-4 sm:grid-cols-2">
          <div>
            <dt class="text-xs text-muted">已配置</dt>
            <dd class="mt-1 font-medium">{{ capability.configured ? '是' : '否' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">已启用</dt>
            <dd class="mt-1 font-medium">{{ capability.enabled ? '是' : '否' }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">新运行提供器</dt>
            <dd class="mt-1 font-medium">{{ contextProvider }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">服务来源</dt>
            <dd class="mt-1 break-all font-medium">{{ capability.endpointOrigin ?? '未配置' }}</dd>
          </div>
        </dl>
        <UAlert class="mt-5" color="neutral" title="SQLite 始终保存原始数据"
          description="OpenViking 不可用时，新任务会改用本地全文搜索；远端同步任务会保留并在服务恢复后重试。已经创建的任务不会中途更换搜索方式。" />
        <UAlert v-if="syncRuntime?.state === 'degraded'" class="mt-4" color="warning" title="OpenViking 已进入自动降级"
          :description="syncRuntime.retryAfter === null
            ? `自动重试已停止：${syncRuntime.lastError ?? '需要管理员检查 OpenViking'}`
            : `新任务使用 SQLite；下次远端探测时间 ${new Date(syncRuntime.retryAfter).toLocaleString('zh-CN')}。${syncRuntime.lastError ?? ''}`" />
        <SystemOpenVikingSettingsForm v-if="openVikingSettings" :key="openVikingSettings.updatedAt ?? 'default'"
          :settings="openVikingSettings" :loading="actionLoading" @submit="saveOpenVikingSettings" />
        <div class="mt-5 flex flex-wrap gap-2">
          <UButton :loading="actionLoading" color="neutral" variant="soft" @click="checkProvider">检测服务</UButton>
          <UButton v-if="failedSyncCount > 0" :loading="actionLoading" color="neutral" variant="soft"
            icon="i-lucide-refresh-cw" @click="retryAllFailed">重新同步失败资料</UButton>
        </div>
        <div class="mt-6 border-t border-default pt-5">
          <UAlert class="mb-4" color="warning" title="全量重建会替换全部远端投影"
            description="系统先检查 OpenViking 处理队列；通过后保留有效世界 User，清理人样管理的资料、Session 和人物 Peer，再按世界 User／人物 Peer 隔离关系从 SQLite 完整重放。预检失败时不会清理远端数据。" />
          <UCheckbox v-model="reindexConfirmed" label="确认删除人样专属远端索引并从 SQLite 全量重建" />
          <UButton class="mt-3" :loading="actionLoading" color="warning" variant="soft" @click="reindex">全量重建索引
          </UButton>
        </div>
      </section>

      <UCard>
        <template #header>
          <h2 class="font-semibold text-highlighted">日志与审计</h2>
        </template>
        <p class="text-sm text-muted">同步日志和关键管理动作已迁移到独立页面，通过服务端分页查看，避免系统中心堆积长列表。</p>
        <dl class="mt-5 grid gap-3 text-sm">
          <div>
            <dt class="text-muted">当前同步失败</dt>
            <dd class="mt-1 font-medium text-highlighted">{{ failedSyncCount }} 项</dd>
          </div>
          <div>
            <dt class="text-muted">记录范围</dt>
            <dd class="mt-1">OpenViking 同步与系统审计</dd>
          </div>
        </dl>
        <UButton class="mt-5" to="/system-records" color="neutral" variant="soft" icon="i-lucide-scroll-text">查看日志与审计
        </UButton>
      </UCard>
    </div>
    <div class="mt-6">
      <SystemBackupPanel />
    </div>
  </div>
</template>
