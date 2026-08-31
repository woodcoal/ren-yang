<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreateAiConnectionInput, SaveAiModelDeploymentInput, UpdateAiConnectionInput } from '#shared/schemas/aiConfiguration'
import type { ApiResponse } from '#shared/types/api'
import type { AiConnectionCheckResult, AiConnectionView, AiModelDeploymentView } from '#shared/types/aiConfiguration'
import { getApiErrorMessage } from '../utils/apiError'

const [connectionRequest, deploymentRequest] = await Promise.all([
  useFetch<ApiResponse<AiConnectionView[]>>('/api/v1/ai/connections'),
  useFetch<ApiResponse<AiModelDeploymentView[]>>('/api/v1/ai/model-deployments'),
])
const connections = computed(() => connectionRequest.data.value?.data ?? [])
const deployments = computed(() => deploymentRequest.data.value?.data ?? [])
const selectedConnection = shallowRef<AiConnectionView | null>(null)
const selectedDeployment = shallowRef<AiModelDeploymentView | null>(null)
const savingConnection = shallowRef(false)
const savingDeployment = shallowRef(false)
const checkingDeploymentId = shallowRef<string | null>(null)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)

/** @param connectionId 连接 UUID。 @returns 部署所属连接名称。 */
function connectionName(connectionId: string): string {
  return connections.value.find(item => item.id === connectionId)?.name ?? '连接不存在'
}

/**
 * 创建新连接或替换当前连接，并刷新两类列表。
 * @param input 已校验的连接参数。
 * @returns 保存和刷新完成时结束。
 */
async function saveConnection(input: CreateAiConnectionInput | UpdateAiConnectionInput): Promise<void> {
  savingConnection.value = true
  actionError.value = null
  actionMessage.value = null
  try {
    const target = selectedConnection.value
    await $fetch(target ? `/api/v1/ai/connections/${target.id}` : '/api/v1/ai/connections', {
      method: target ? 'PUT' : 'POST', body: input,
    })
    selectedConnection.value = null
    await Promise.all([connectionRequest.refresh(), deploymentRequest.refresh()])
    actionMessage.value = 'AI 接口连接已保存，密钥不会返回到浏览器。'
  }
  catch (error: unknown) {
    actionError.value = getApiErrorMessage(error, 'AI 接口连接保存失败')
  }
  finally {
    savingConnection.value = false
  }
}

/**
 * 创建新部署或替换当前部署并刷新列表。
 * @param input 已校验的完整模型部署参数。
 * @returns 保存和刷新完成时结束。
 */
async function saveDeployment(input: SaveAiModelDeploymentInput): Promise<void> {
  savingDeployment.value = true
  actionError.value = null
  actionMessage.value = null
  try {
    const target = selectedDeployment.value
    await $fetch(target ? `/api/v1/ai/model-deployments/${target.id}` : '/api/v1/ai/model-deployments', {
      method: target ? 'PUT' : 'POST', body: input,
    })
    selectedDeployment.value = null
    await deploymentRequest.refresh()
    actionMessage.value = 'AI 模型部署已保存。'
  }
  catch (error: unknown) {
    actionError.value = getApiErrorMessage(error, 'AI 模型部署保存失败')
  }
  finally {
    savingDeployment.value = false
  }
}

/**
 * 对文本模型执行真实最小请求，验证地址、密钥和模型标识。
 * @param deployment 待检测的文本模型部署。
 * @returns 检测完成时结束。
 */
async function checkDeployment(deployment: AiModelDeploymentView): Promise<void> {
  checkingDeploymentId.value = deployment.id
  actionError.value = null
  actionMessage.value = null
  try {
    const response = await $fetch<ApiResponse<AiConnectionCheckResult>>(`/api/v1/ai/model-deployments/${deployment.id}/check`, { method: 'POST' })
    actionMessage.value = `${deployment.name}：${response.data.message}`
  }
  catch (error: unknown) {
    actionError.value = getApiErrorMessage(error, '文本模型检测失败')
  }
  finally {
    checkingDeploymentId.value = null
  }
}
</script>

<template>
  <div>
    <ContentPageHeader title="AI 模型" description="集中维护不同端点、加密凭据和具体模型部署；算法配置只引用模型部署。" />
    <div class="status-strip page-status-strip" aria-label="AI 模型状态摘要">
      <div class="status-cell"><span class="status-kicker">接口连接</span><strong class="status-value">{{ connections.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">模型部署</span><strong class="status-value">{{ deployments.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">文本模型</span><strong class="status-value">{{ deployments.filter(item => item.modality === 'text' && item.isEnabled).length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">凭据展示</span><strong class="status-value">仅显示已配置</strong></div>
    </div>
    <div class="space-y-5 py-9">
      <UAlert color="neutral" variant="subtle" title="凭据安全边界" description="API Key 使用 AES-256-GCM 加密存入数据库；本地主密钥不入库，浏览器、审计和运行快照均不返回明文。" />
      <UAlert v-if="connectionRequest.error.value || deploymentRequest.error.value" color="error" title="AI 模型配置加载失败" />
      <UAlert v-if="actionError" color="error" title="操作失败" :description="actionError" />
      <UAlert v-if="actionMessage" color="success" title="操作完成" :description="actionMessage" />

      <div class="grid gap-6 2xl:grid-cols-2">
        <AiConfigurationAiConnectionEditor
          :key="`${selectedConnection?.id ?? 'new'}-${selectedConnection?.updatedAt ?? 0}`"
          :connection="selectedConnection"
          :loading="savingConnection"
          @save="saveConnection"
          @cancel="selectedConnection = null"
        />
        <AiConfigurationAiModelDeploymentEditor
          :key="`${selectedDeployment?.id ?? 'new'}-${selectedDeployment?.updatedAt ?? 0}-${connections.length}`"
          :connections="connections"
          :deployment="selectedDeployment"
          :loading="savingDeployment"
          @save="saveDeployment"
          @cancel="selectedDeployment = null"
        />
      </div>

      <section class="archive-panel" aria-labelledby="ai-connection-list-heading">
        <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">连接列表</p><h2 id="ai-connection-list-heading">接口与加密凭据状态</h2></div></div>
        <div v-if="connections.length" class="log-list">
          <article v-for="connection in connections" :key="connection.id" class="log-row">
            <div class="log-row-main"><strong class="log-row-title">{{ connection.name }}</strong><p class="break-all text-sm text-muted">{{ connection.endpoint }}</p></div>
            <div class="log-row-end flex items-center gap-2"><UBadge color="neutral" variant="subtle">{{ connection.hasApiKey ? '密钥已配置' : '无密钥' }}</UBadge><UBadge :color="connection.isEnabled ? 'success' : 'neutral'" variant="subtle">{{ connection.isEnabled ? '已启用' : '未启用' }}</UBadge><UButton size="xs" color="neutral" variant="soft" @click="selectedConnection = connection">编辑</UButton></div>
          </article>
        </div>
        <div v-else class="content-empty-state"><div><strong>还没有接口连接</strong><p>先录入端点与 API Key，再登记具体模型。</p></div></div>
      </section>

      <section class="archive-panel" aria-labelledby="ai-deployment-list-heading">
        <div class="section-heading"><div class="section-heading-copy"><p class="eyebrow">部署列表</p><h2 id="ai-deployment-list-heading">可供算法选择的模型</h2></div></div>
        <div v-if="deployments.length" class="log-list">
          <article v-for="deployment in deployments" :key="deployment.id" class="log-row">
            <div class="log-row-main"><strong class="log-row-title">{{ deployment.name }}</strong><p class="text-sm text-muted">{{ connectionName(deployment.connectionId) }} · {{ deployment.model }}</p></div>
            <div class="log-row-end flex items-center gap-2"><UBadge color="neutral" variant="subtle">{{ deployment.modality === 'text' ? '文本' : '图片' }}</UBadge><UBadge :color="deployment.isEnabled ? 'success' : 'neutral'" variant="subtle">{{ deployment.isEnabled ? '已启用' : '未启用' }}</UBadge><UButton v-if="deployment.modality === 'text'" size="xs" color="neutral" variant="soft" :loading="checkingDeploymentId === deployment.id" @click="checkDeployment(deployment)">检测</UButton><UButton size="xs" color="neutral" variant="soft" @click="selectedDeployment = deployment">编辑</UButton></div>
          </article>
        </div>
        <div v-else class="content-empty-state"><div><strong>还没有模型部署</strong><p>一个接口可以登记多个不同模型。</p></div></div>
      </section>
    </div>
  </div>
</template>
