<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import type { ArtifactFormat, DocumentSpec } from '#shared/schemas/generation'
import type { ApiResponse } from '#shared/types/api'
import type { RenderedArtifactView, RunDetails } from '#shared/types/generation'
import { getApiErrorMessage } from '../../utils/apiError'

const route = useRoute()
const runId = String(route.params.id)
const { data, error, refresh } = await useFetch<ApiResponse<RunDetails>>(`/api/v1/runs/${runId}`)
const details = computed(() => data.value?.data ?? null)
const active = computed(() => details.value ? ['planning', 'queued', 'running'].includes(details.value.run.status) : false)
const draftSpec = computed(() => details.value?.documentSpecs.find(spec => spec.status === 'draft') ?? null)
const confirmedSpec = computed(() => details.value?.documentSpecs.find(spec => spec.status === 'confirmed') ?? null)
const artifactFormats = computed<ArtifactFormat[]>(() => confirmedSpec.value?.spec.requestedFormats ?? [])
const canRenderArtifact = computed(() => details.value?.blocks.some(block => block.selectedAttemptId) ?? false)
const actionLoading = shallowRef(false)
const actionError = shallowRef<string | null>(null)
const actionMessage = shallowRef<string | null>(null)
const pollingTimer = shallowRef<ReturnType<typeof setInterval> | null>(null)
const artifactPreview = shallowRef<RenderedArtifactView | null>(null)

/** @returns 启动每两秒一次的活动运行轮询；已有计时器时不重复创建。 */
function startPolling(): void {
  if (pollingTimer.value || !active.value) return
  pollingTimer.value = setInterval(() => { void refresh() }, 2_000)
}

/** @returns 停止运行详情轮询并释放计时器。 */
function stopPolling(): void {
  if (!pollingTimer.value) return
  clearInterval(pollingTimer.value)
  pollingTimer.value = null
}

watch(active, value => value ? startPolling() : stopPolling())
onMounted(startPolling)
onUnmounted(stopPolling)

/** @param spec 已通过组件校验的文档规格。 @returns 保存一个新的不可变规格修订。 */
async function saveSpec(spec: DocumentSpec): Promise<void> {
  await executeAction(async () => {
    await $fetch(`/api/v1/runs/${runId}/document-spec`, { method: 'PUT', body: spec })
    actionMessage.value = '已保存新的规格修订'
  })
}

/** @param spec 已通过组件校验的当前规格。 @returns 保存修订、确认规格并创建块执行任务。 */
async function confirmSpec(spec: DocumentSpec): Promise<void> {
  await executeAction(async () => {
    await $fetch(`/api/v1/runs/${runId}/document-spec`, { method: 'PUT', body: spec })
    await $fetch(`/api/v1/runs/${runId}/document-spec/confirm`, { method: 'POST' })
    actionMessage.value = '规格已确认，图文块已进入执行队列'
  })
}

/** @returns 请求取消排队或运行中的任务。 */
async function cancelRun(): Promise<void> {
  await executeAction(async () => {
    await $fetch(`/api/v1/runs/${runId}/cancel`, { method: 'POST' })
    actionMessage.value = '取消请求已处理'
  })
}

/** @returns 为失败或部分成功运行创建新的任务记录。 */
async function retryRun(): Promise<void> {
  await executeAction(async () => {
    await $fetch(`/api/v1/runs/${runId}/retry`, { method: 'POST' })
    actionMessage.value = '已创建新的重试任务'
  })
}

/** @param blockId 目标块 UUID。 @returns 创建单块任务并刷新尝试历史。 */
async function retryBlock(blockId: string): Promise<void> {
  await executeAction(async () => {
    await $fetch(`/api/v1/runs/${runId}/blocks/${blockId}/attempts`, { method: 'POST' })
    actionMessage.value = '已创建单块重试任务'
  })
}

/** @param blockId 目标块 UUID。 @param attemptId 历史成功尝试 UUID。 @returns 切换当前选择并刷新详情。 */
async function selectBlockAttempt(blockId: string, attemptId: string): Promise<void> {
  await executeAction(async () => {
    await $fetch(`/api/v1/runs/${runId}/blocks/${blockId}/select`, { method: 'POST', body: { attemptId } })
    actionMessage.value = '已切换当前选中尝试'
  })
}

/** @param blockId 目标块 UUID。 @param locked 新锁定状态。 @returns 更新锁定状态并刷新详情。 */
async function setBlockLock(blockId: string, locked: boolean): Promise<void> {
  await executeAction(async () => {
    await $fetch(`/api/v1/runs/${runId}/blocks/${blockId}/lock`, { method: 'POST', body: { locked } })
    actionMessage.value = locked ? '已锁定当前结果' : '已解除块锁定'
  })
}

/** @returns 从服务端按同一组选中尝试生成全部允许格式的安全预览。 */
async function renderArtifact(): Promise<void> {
  if (actionLoading.value || artifactFormats.value.length === 0) return
  actionLoading.value = true
  actionError.value = null
  actionMessage.value = null
  try {
    const response = await $fetch<ApiResponse<RenderedArtifactView>>(`/api/v1/runs/${runId}/render`, {
      method: 'POST', body: { formats: artifactFormats.value },
    })
    artifactPreview.value = response.data
  }
  catch (requestError: unknown) {
    actionError.value = getApiErrorMessage(requestError, '产物预览失败')
  }
  finally {
    actionLoading.value = false
  }
}

/** @param action 单次写操作。 @returns 统一处理提交锁、错误和详情刷新。 */
async function executeAction(action: () => Promise<void>): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  actionError.value = null
  actionMessage.value = null
  try {
    await action()
    artifactPreview.value = null
    await refresh()
  }
  catch (requestError: unknown) {
    actionError.value = getApiErrorMessage(requestError, '运行操作失败')
  }
  finally {
    actionLoading.value = false
  }
}

/** @param timestamp 可空 UTC Unix 毫秒。 @returns 本地日期时间或占位文本。 */
function formatTime(timestamp: number | null): string {
  return timestamp === null ? '—' : new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<template>
  <div>
    <ContentPageHeader title="运行详情" description="查看固定输入、证据快照、规格修订、图文块尝试和任务状态。">
      <UButton to="/history" color="neutral" variant="ghost">返回历史</UButton>
    </ContentPageHeader>

    <UAlert v-if="error || !details" color="error" title="运行详情加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <template v-else>
      <UAlert v-if="actionError" class="mb-5" color="error" title="操作失败" :description="actionError" />
      <UAlert v-if="actionMessage" class="mb-5" color="success" title="操作完成" :description="actionMessage" />

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div class="space-y-6">
          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">固定输入</h2></template>
            <pre class="content-pre">{{ 'content' in details.run.input ? details.run.input.content : details.run.input.requirement }}</pre>
            <div v-if="details.run.scene" class="mt-4 rounded-md bg-elevated p-3 text-sm">
              <p class="font-medium text-highlighted">临时场景</p><pre class="content-pre mt-2">{{ JSON.stringify(details.run.scene, null, 2) }}</pre>
            </div>
          </UCard>

          <UCard v-if="details.run.result">
            <template #header><h2 class="font-semibold text-highlighted">兴趣判断结果</h2></template>
            <div class="grid gap-3 sm:grid-cols-3">
              <div><p class="text-xs text-muted">结论</p><p class="mt-1 font-medium">{{ details.run.result.decision }}</p></div>
              <div><p class="text-xs text-muted">兴趣概率</p><p class="mt-1 font-medium">{{ Math.round(details.run.result.probability * 100) }}%</p></div>
              <div><p class="text-xs text-muted">置信度</p><p class="mt-1 font-medium">{{ Math.round(details.run.result.confidence * 100) }}%</p></div>
            </div>
            <p class="mt-4 text-sm">{{ details.run.result.reasoningSummary }}</p>
            <div class="mt-4 space-y-2"><p v-for="factor in details.run.result.factors" :key="factor.dimension" class="rounded-md bg-elevated p-3 text-sm"><strong>{{ factor.dimension }} {{ factor.score }}</strong>：{{ factor.explanation }}</p></div>
            <div v-if="details.run.result.unknowns.length" class="mt-4"><p class="text-sm font-medium">不确定项</p><ul class="mt-2 list-disc pl-5 text-sm text-muted"><li v-for="item in details.run.result.unknowns" :key="item">{{ item }}</li></ul></div>
          </UCard>

          <UCard v-if="draftSpec && details.run.status === 'awaiting_confirmation'">
            <template #header><div><h2 class="font-semibold text-highlighted">确认文档规格</h2><p class="mt-1 text-sm text-muted">当前为修订 v{{ draftSpec.revision }}，确认前不会生成图文块。</p></div></template>
            <GenerationDocumentSpecEditor
              :spec="draftSpec.spec"
              :allow-images="'includeImages' in details.run.input && details.run.input.includeImages"
              :loading="actionLoading"
              @save="saveSpec"
              @confirm="confirmSpec"
            />
          </UCard>

          <UCard v-if="details.blocks.length">
            <template #header><h2 class="font-semibold text-highlighted">产物图文块</h2></template>
            <div class="space-y-4">
              <GenerationArtifactBlockCard
                v-for="block in details.blocks"
                :key="block.id"
                :run-id="runId"
                :block="block"
                :loading="actionLoading"
                :actions-disabled="active"
                @retry="retryBlock(block.id)"
                @select="selectBlockAttempt(block.id, $event)"
                @lock="setBlockLock(block.id, $event)"
              />
            </div>
          </UCard>

          <GenerationArtifactPreview
            v-if="confirmedSpec && canRenderArtifact"
            :run-id="runId"
            :formats="artifactFormats"
            :preview="artifactPreview"
            :loading="actionLoading"
            @render="renderArtifact"
          />

          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">证据快照</h2></template>
            <GenerationEvidenceList :evidence="details.evidence" />
          </UCard>
        </div>

        <div class="space-y-6">
          <GenerationRunStatusPanel :run="details.run" :tasks="details.tasks" :loading="actionLoading" @cancel="cancelRun" @retry="retryRun" />
          <UCard>
            <template #header><h2 class="font-semibold text-highlighted">运行快照</h2></template>
            <dl class="space-y-3 text-sm">
              <div><dt class="text-muted">人物版本</dt><dd class="break-all">{{ details.run.personaVersionId }}</dd></div>
              <div><dt class="text-muted">提示版本</dt><dd>{{ details.run.promptVersion }}</dd></div>
              <div v-if="details.run.imageModel"><dt class="text-muted">图片模型</dt><dd>{{ details.run.imageModel.model }}</dd></div>
              <div><dt class="text-muted">参数</dt><dd><pre class="content-pre">{{ JSON.stringify(details.run.parameters, null, 2) }}</pre></dd></div>
              <div><dt class="text-muted">完成时间</dt><dd>{{ formatTime(details.run.completedAt) }}</dd></div>
            </dl>
          </UCard>
          <UCard v-if="details.documentSpecs.length > 1">
            <template #header><h2 class="font-semibold text-highlighted">规格修订历史</h2></template>
            <div class="space-y-2 text-sm"><p v-for="spec in details.documentSpecs" :key="spec.id">v{{ spec.revision }} · {{ spec.status }} · {{ formatTime(spec.createdAt) }}</p></div>
          </UCard>
        </div>
      </div>
    </template>
  </div>
</template>
