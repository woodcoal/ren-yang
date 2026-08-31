<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { CreateAiConnectionInput, SaveAiModelDeploymentInput, UpdateAiConnectionInput } from '#shared/schemas/aiConfiguration'
import type { ApiResponse } from '#shared/types/api'
import type { AiConnectionCheckResult, AiConnectionView, AiModelDeploymentView } from '#shared/types/aiConfiguration'
import { getApiErrorMessage } from '../utils/apiError'

/** AI 模型页的两个管理阶段。 */
type AiModelManagementView = 'connections' | 'deployments'

const [connectionRequest, deploymentRequest] = await Promise.all([
  useFetch<ApiResponse<AiConnectionView[]>>('/api/v1/ai/connections'),
  useFetch<ApiResponse<AiModelDeploymentView[]>>('/api/v1/ai/model-deployments'),
])
const connections = computed(() => connectionRequest.data.value?.data ?? [])
const deployments = computed(() => deploymentRequest.data.value?.data ?? [])
const activeView = shallowRef<AiModelManagementView>('connections')
const selectedConnection = shallowRef<AiConnectionView | null>(null)
const selectedDeployment = shallowRef<AiModelDeploymentView | null>(null)
const connectionEditorOpen = shallowRef(false)
const deploymentEditorOpen = shallowRef(false)
const connectionFilter = shallowRef('all')
const savingConnection = shallowRef(false)
const savingDeployment = shallowRef(false)
const checkingDeploymentId = shallowRef<string | null>(null)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)
const filteredDeployments = computed(() => connectionFilter.value === 'all'
  ? deployments.value
  : deployments.value.filter(deployment => deployment.connectionId === connectionFilter.value))
const connectionFilterItems = computed(() => [
  { label: '全部接口', value: 'all' },
  ...connections.value.map(connection => ({ label: connection.name, value: connection.id })),
])

/**
 * 查找模型部署所属的接口名称。
 * @param connectionId 连接 UUID。
 * @returns 脱敏接口名称；引用失效时返回固定说明。
 */
function connectionName(connectionId: string): string {
  return connections.value.find(item => item.id === connectionId)?.name ?? '连接不存在'
}

/**
 * 切换接口连接或模型部署管理阶段。
 * @param view 目标管理阶段。
 * @returns 无返回值。
 */
function switchView(view: AiModelManagementView): void {
  activeView.value = view
  actionError.value = null
  actionMessage.value = null
}

/**
 * 打开新建接口编辑器。
 * @returns 无返回值。
 */
function createConnection(): void {
  selectedConnection.value = null
  connectionEditorOpen.value = true
}

/**
 * 打开指定接口的编辑器，不会把已有密钥回填到表单。
 * @param connection 待编辑的脱敏接口连接。
 * @returns 无返回值。
 */
function editConnection(connection: AiConnectionView): void {
  selectedConnection.value = connection
  connectionEditorOpen.value = true
}

/**
 * 关闭接口编辑器并清除编辑目标。
 * @returns 无返回值。
 */
function closeConnectionEditor(): void {
  selectedConnection.value = null
  connectionEditorOpen.value = false
}

/**
 * 打开新建模型部署编辑器。
 * @returns 无返回值。
 */
function createDeployment(): void {
  selectedDeployment.value = null
  deploymentEditorOpen.value = true
}

/**
 * 打开指定模型部署的编辑器。
 * @param deployment 待编辑的模型部署。
 * @returns 无返回值。
 */
function editDeployment(deployment: AiModelDeploymentView): void {
  selectedDeployment.value = deployment
  deploymentEditorOpen.value = true
}

/**
 * 关闭模型部署编辑器并清除编辑目标。
 * @returns 无返回值。
 */
function closeDeploymentEditor(): void {
  selectedDeployment.value = null
  deploymentEditorOpen.value = false
}

/**
 * 创建新接口或替换当前接口，并刷新两类列表。
 * @param input 已校验的接口连接参数。
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
    closeConnectionEditor()
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
    closeDeploymentEditor()
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
    <ContentPageHeader title="AI 模型" description="先建立带加密凭据的接口连接，再在连接上登记可供算法选择的具体文本或图片模型。" />
    <div class="status-strip page-status-strip" aria-label="AI 模型状态摘要">
      <div class="status-cell"><span class="status-kicker">接口连接</span><strong class="status-value">{{ connections.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">模型部署</span><strong class="status-value">{{ deployments.length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">启用文本模型</span><strong class="status-value">{{ deployments.filter(item => item.modality === 'text' && item.isEnabled).length }}</strong></div>
      <div class="status-cell"><span class="status-kicker">凭据展示</span><strong class="status-value">仅显示已配置</strong></div>
    </div>

    <div class="model-setup-path" aria-label="AI 模型配置顺序">
      <button type="button" :class="{ 'model-setup-step--active': activeView === 'connections' }" class="model-setup-step" @click="switchView('connections')">
        <span>1</span><span><strong>接口连接</strong><small>端点、协议和加密 API Key</small></span><UBadge :color="connections.length ? 'success' : 'warning'" variant="subtle">{{ connections.length ? '已建立' : '先配置' }}</UBadge>
      </button>
      <button type="button" :class="{ 'model-setup-step--active': activeView === 'deployments' }" class="model-setup-step" @click="switchView('deployments')">
        <span>2</span><span><strong>模型部署</strong><small>一个接口可登记多个模型</small></span><UBadge :color="deployments.length ? 'success' : 'neutral'" variant="subtle">{{ deployments.length }} 个</UBadge>
      </button>
    </div>

    <div class="space-y-5 py-9">
      <UAlert color="neutral" variant="subtle" title="凭据安全边界" description="API Key 使用 AES-256-GCM 加密存入数据库；本地主密钥不入库，浏览器、审计和运行快照均不返回明文。" />
      <UAlert v-if="connectionRequest.error.value || deploymentRequest.error.value" color="error" title="AI 模型配置加载失败" />
      <UAlert v-if="actionError" color="error" title="操作失败" :description="actionError" />
      <UAlert v-if="actionMessage" color="success" title="操作完成" :description="actionMessage" />

      <template v-if="activeView === 'connections'">
        <section class="archive-panel" aria-labelledby="ai-connection-list-heading">
          <div class="section-heading">
            <div class="section-heading-copy"><p class="eyebrow">第一步</p><h2 id="ai-connection-list-heading">接口连接</h2><p>每个连接代表一个独立端点和其加密凭据。</p></div>
            <UButton icon="i-lucide-plus" @click="createConnection">新增接口</UButton>
          </div>
          <AiConfigurationAiConnectionEditor
            v-if="connectionEditorOpen"
            :key="`${selectedConnection?.id ?? 'new'}-${selectedConnection?.updatedAt ?? 0}`"
            class="mb-6"
            :connection="selectedConnection"
            :loading="savingConnection"
            @save="saveConnection"
            @cancel="closeConnectionEditor"
          />
          <div v-if="connections.length" class="log-list">
            <article v-for="connection in connections" :key="connection.id" class="log-row">
              <span class="log-row-meta">{{ connection.protocol === 'openai_compatible' ? 'OpenAI 兼容' : connection.protocol }}</span>
              <div class="log-row-main"><strong class="log-row-title">{{ connection.name }}</strong><p class="break-all text-sm text-muted">{{ connection.endpoint }}</p><p class="break-all text-xs text-muted">UserAgent：{{ connection.userAgent || '运行环境默认值' }}</p></div>
              <div class="log-row-end flex flex-wrap items-center justify-end gap-2"><UBadge color="neutral" variant="subtle">{{ connection.hasApiKey ? '密钥已配置' : '无密钥' }}</UBadge><UBadge :color="connection.isEnabled ? 'success' : 'neutral'" variant="subtle">{{ connection.isEnabled ? '已启用' : '未启用' }}</UBadge><UButton size="xs" color="neutral" variant="soft" @click="editConnection(connection)">编辑</UButton></div>
            </article>
          </div>
          <div v-else-if="!connectionEditorOpen" class="content-empty-state"><div><strong>还没有接口连接</strong><p>先录入端点与 API Key，再登记具体模型。</p><UButton class="mt-4" @click="createConnection">创建第一个接口</UButton></div></div>
        </section>
      </template>

      <template v-else>
        <section class="archive-panel" aria-labelledby="ai-deployment-list-heading">
          <div class="section-heading">
            <div class="section-heading-copy"><p class="eyebrow">第二步</p><h2 id="ai-deployment-list-heading">模型部署</h2><p>算法只选择具体部署，同一接口可登记多个不同模型。</p></div>
            <UButton icon="i-lucide-plus" :disabled="connections.length === 0" @click="createDeployment">新增模型</UButton>
          </div>
          <UAlert v-if="connections.length === 0" class="mb-5" color="warning" title="请先建立接口连接" description="模型必须属于一个已知端点。" :actions="[{ label: '返回第一步', onClick: () => switchView('connections') }]" />
          <AiConfigurationAiModelDeploymentEditor
            v-if="deploymentEditorOpen"
            :key="`${selectedDeployment?.id ?? 'new'}-${selectedDeployment?.updatedAt ?? 0}-${connections.length}`"
            class="mb-6"
            :connections="connections"
            :deployment="selectedDeployment"
            :loading="savingDeployment"
            @save="saveDeployment"
            @cancel="closeDeploymentEditor"
          />
          <div v-if="deployments.length" class="mb-4 max-w-sm">
            <UFormField label="按接口筛选"><USelect v-model="connectionFilter" class="w-full" :items="connectionFilterItems" /></UFormField>
          </div>
          <div v-if="filteredDeployments.length" class="log-list">
            <article v-for="deployment in filteredDeployments" :key="deployment.id" class="log-row">
              <span class="log-row-meta">{{ deployment.modality === 'text' ? '文本模型' : '图片模型' }}</span>
              <div class="log-row-main"><strong class="log-row-title">{{ deployment.name }}</strong><p class="text-sm text-muted">{{ connectionName(deployment.connectionId) }} · {{ deployment.model }}</p></div>
              <div class="log-row-end flex flex-wrap items-center justify-end gap-2"><UBadge :color="deployment.isEnabled ? 'success' : 'neutral'" variant="subtle">{{ deployment.isEnabled ? '已启用' : '未启用' }}</UBadge><UButton v-if="deployment.modality === 'text'" size="xs" color="neutral" variant="soft" :loading="checkingDeploymentId === deployment.id" @click="checkDeployment(deployment)">真实检测</UButton><UButton size="xs" color="neutral" variant="soft" @click="editDeployment(deployment)">编辑</UButton></div>
            </article>
          </div>
          <div v-else-if="connections.length && !deploymentEditorOpen" class="content-empty-state"><div><strong>{{ deployments.length ? '当前筛选下没有模型' : '还没有模型部署' }}</strong><p>登记供应商模型标识后，算法才能选择它。</p></div></div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.model-setup-path {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 2rem;
  overflow: hidden;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-control);
  background: var(--app-surface-raised);
}

.model-setup-step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.875rem;
  padding: 1rem 1.25rem;
  border: 0;
  border-left: 1px solid var(--app-border);
  background: transparent;
  color: var(--app-muted);
  text-align: left;
  cursor: pointer;
}

.model-setup-step:first-child {
  border-left: 0;
}

.model-setup-step > span:first-child {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 1px solid var(--app-border-strong);
  border-radius: 50%;
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.model-setup-step > span:nth-child(2) {
  display: grid;
  gap: 0.2rem;
}

.model-setup-step strong {
  color: var(--app-fg);
}

.model-setup-step small {
  font-size: 0.75rem;
}

.model-setup-step:hover,
.model-setup-step--active {
  background: var(--app-surface-soft);
}

.model-setup-step--active {
  box-shadow: inset 0 -3px 0 var(--app-accent);
}

.model-setup-step--active > span:first-child {
  border-color: var(--app-accent);
  background: var(--app-accent);
  color: var(--app-surface-raised);
}

@media (max-width: 48rem) {
  .model-setup-path {
    grid-template-columns: 1fr;
  }

  .model-setup-step,
  .model-setup-step:first-child {
    border-top: 1px solid var(--app-border);
    border-left: 0;
  }

  .model-setup-step:first-child {
    border-top: 0;
  }
}
</style>
