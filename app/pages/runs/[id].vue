<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import type { ArtifactFormat, ArtifactOutputFormat } from '#shared/schemas/generation'
import type { ConfirmFeedbackClassificationInput, SubmitFeedbackInput } from '#shared/schemas/feedback'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaDetails, PersonaSnapshot } from '#shared/types/content'
import type { FeedbackView } from '#shared/types/feedback'
import type { RenderedArtifactView, RunDetails } from '#shared/types/generation'
import { getApiErrorMessage } from '../../utils/apiError'

const route = useRoute()
const runId = String(route.params.id)
const { runWithAiLoading } = useAiLoading()
const { notifySuccess, notifyError } = useOperationNotifications()
const { data, error, refresh } = await useFetch<ApiResponse<RunDetails>>(`/api/v1/runs/${runId}`)
const details = computed(() => data.value?.data ?? null)
const personaId = computed(() => details.value?.run.personaId ?? '')
const [{ data: feedbackData, refresh: refreshFeedback }, { data: personaData, refresh: refreshPersona }] = await Promise.all([
  useFetch<ApiResponse<FeedbackView[]>>('/api/v1/feedback'),
  useFetch<ApiResponse<PersonaDetails>>(() => `/api/v1/personas/${personaId.value}`, {
    immediate: Boolean(personaId.value),
    watch: [personaId],
  }),
])
const active = computed(() => details.value ? ['planning', 'queued', 'running'].includes(details.value.run.status) : false)
const artifactOutputFormat = computed<ArtifactOutputFormat | null>(() => {
  const input = details.value?.run.input
  return input && 'requirement' in input ? input.outputFormat : null
})
const artifactFormat = computed<ArtifactFormat | null>(() => {
  if (artifactOutputFormat.value === 'html') return 'html'
  if (artifactOutputFormat.value === 'text') return 'txt'
  return null
})
const artifactReady = computed(() => {
  if (details.value?.run.kind !== 'artifact_generation') return false
  if (!['succeeded', 'partial'].includes(details.value.run.status)) return false
  return details.value.blocks.some(block => block.selectedAttemptId)
})
const runFeedback = computed(() => (feedbackData.value?.data ?? []).filter(item => item.runId === runId))
const pendingFeedback = computed(() => runFeedback.value.filter(item => item.confirmedTarget === null))
const personaDetails = computed(() => personaData.value?.data ?? null)
const personaVersion = computed(() => personaDetails.value?.versions.find(version => version.id === details.value?.run.personaVersionId) ?? null)
const personaSnapshotFields = computed(() => personaVersion.value ? toPersonaSnapshotFields(personaVersion.value.snapshot) : [])
const actionLoading = shallowRef(false)
const artifactLoading = shallowRef(false)
const artifactLoadAttempted = shallowRef(false)
const artifactError = shallowRef<string | null>(null)
const artifactResult = shallowRef<RenderedArtifactView | null>(null)
const pollingTimer = shallowRef<ReturnType<typeof setInterval> | null>(null)
const selectedTab = shallowRef<'result' | 'evidence' | 'feedback' | 'settings'>('result')

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
watch(artifactReady, (ready) => {
  if (ready) void loadArtifactResult()
}, { immediate: true })
onMounted(startPolling)
onUnmounted(stopPolling)

/** @returns 请求取消排队或运行中的任务。 */
async function cancelRun(): Promise<void> {
  await executeAction('取消请求已处理', async () => {
    await $fetch(`/api/v1/runs/${runId}/cancel`, { method: 'POST' })
  })
}

/** @returns 为失败或部分成功运行创建新的任务记录。 */
async function retryRun(): Promise<void> {
  await executeAction('已创建新的重试任务', async () => {
    await runWithAiLoading({
      title: 'AI 正在准备重试任务',
      description: '系统正在复用固定输入和人物版本，继续生成未完成的结果。',
      completionHint: '任务建立后，详情页会继续显示处理进度。',
    }, async () => await $fetch(`/api/v1/runs/${runId}/retry`, { method: 'POST' }))
  })
}

/** @returns 自动读取当前运行唯一输出格式的最终正文与图片数据。 */
async function loadArtifactResult(): Promise<void> {
  const format = artifactFormat.value
  if (!artifactReady.value || !format || artifactLoading.value || artifactLoadAttempted.value) return
  artifactLoading.value = true
  artifactLoadAttempted.value = true
  artifactError.value = null
  try {
    const response = await $fetch<ApiResponse<RenderedArtifactView>>(`/api/v1/runs/${runId}/render`, {
      method: 'POST',
      body: { formats: [format] },
    })
    artifactResult.value = response.data
  }
  catch (requestError: unknown) {
    artifactError.value = getApiErrorMessage(requestError, '生成结果读取失败')
  }
  finally {
    artifactLoading.value = false
  }
}

/** @returns 清除上次读取错误并重新获取最终结果。 */
function retryArtifactResult(): void {
  artifactLoadAttempted.value = false
  void loadArtifactResult()
}

/** @param input 原始反馈输入。 @returns 保存反馈并展示 AI 分类建议。 */
async function submitFeedback(input: SubmitFeedbackInput): Promise<void> {
  await executeAction('反馈已保存，请确认或纠正 AI 分类建议', async () => {
    await runWithAiLoading({
      title: 'AI 正在分析反馈用途',
      description: '模型正在判断反馈更适合作为本次修正、人物成长素材或其他长期依据。',
      completionHint: '完成后会展示分类建议，最终用途仍由你确认。',
    }, async () => await $fetch(`/api/v1/runs/${runId}/feedback`, { method: 'POST', body: input }))
    await refreshFeedback()
  })
}

/**
 * 执行用户确认后的反馈分类动作。
 * @param feedbackId 反馈 UUID。
 * @param input 用户确认后的分类动作。
 * @returns 动作执行及运行、人物、反馈刷新完成时结束。
 */
async function confirmFeedback(feedbackId: string, input: ConfirmFeedbackClassificationInput): Promise<void> {
  const successMessage = input.targetType === 'persona'
    ? '反馈已加入人物成长素材池，尚未改变当前提示词'
    : '反馈分类已确认，对应动作已执行'
  await executeAction(successMessage, async () => {
    await $fetch(`/api/v1/feedback/${feedbackId}/classify`, { method: 'POST', body: input })
    await Promise.all([refreshFeedback(), refreshPersona()])
  })
}

/**
 * 统一处理运行写操作、通知和详情刷新。
 * @param successMessage 操作成功通知。
 * @param action 单次写操作。
 * @returns 操作成功或失败处理完成时结束。
 */
async function executeAction(successMessage: string, action: () => Promise<void>): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    await action()
    artifactResult.value = null
    artifactLoadAttempted.value = false
    await refresh()
    notifySuccess(successMessage)
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, '运行操作失败'))
  }
  finally {
    actionLoading.value = false
  }
}

/** @param timestamp 可空 UTC Unix 毫秒。 @returns 本地日期时间或占位文本。 */
function formatTime(timestamp: number | null): string {
  return timestamp === null ? '—' : new Date(timestamp).toLocaleString('zh-CN')
}

/** @param snapshot 不可变人物版本快照。 @returns 按固定顺序展示的中文字段。 */
function toPersonaSnapshotFields(snapshot: PersonaSnapshot): Array<{ label: string, value: string }> {
  return [{ label: '实际使用的灵魂提示词', value: snapshot.promptText }]
}

/** @param category 运行上下文分类。 @returns 后台通俗分类名称。 */
function promptCategoryLabel(category: string): string {
  return ({ world_growth: '世界成长', persona_growth: '人物成长', persona_memory: '人物记忆', source: '参考资料' } as Record<string, string>)[category] ?? category
}

/** @param reason 稳定跳过原因。 @returns 用户可理解的原因。 */
function skippedReasonLabel(reason: string | null): string {
  return ({ category_budget: '超过本类长度', parent_budget: '超过世界或人物总长度', total_budget: '超过模型可用输入', scope_or_state_invalid: '已失效或不属于当前人物' } as Record<string, string>)[reason ?? ''] ?? '未选入'
}
</script>

<template>
  <div>
    <ContentPageHeader
      :title="details ? `${details.run.personaName} · ${details.run.kind === 'interest_assessment' ? '兴趣判断' : '文章创作'}` : '任务详情'"
      description="查看生成结果，并追溯本次任务使用的人物、资料和运行设置。"
    >
      <UButton to="/history" color="neutral" variant="ghost">返回历史</UButton>
    </ContentPageHeader>

    <UAlert v-if="error || !details" color="error" title="运行详情加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <template v-else>
      <GenerationRunStatusPanel :run="details.run" :tasks="details.tasks" :loading="actionLoading" @cancel="cancelRun" @retry="retryRun" />
      <nav class="mind-tabs my-6" aria-label="任务详情标签">
        <button class="mind-tab" :aria-selected="selectedTab === 'result'" @click="selectedTab = 'result'">结果</button>
        <button class="mind-tab" :aria-selected="selectedTab === 'evidence'" @click="selectedTab = 'evidence'">使用依据</button>
        <button class="mind-tab" :aria-selected="selectedTab === 'feedback'" @click="selectedTab = 'feedback'">反馈学习</button>
        <button class="mind-tab" :aria-selected="selectedTab === 'settings'" @click="selectedTab = 'settings'">运行设置</button>
      </nav>

      <div v-if="selectedTab === 'result'" class="space-y-6">
        <UCard>
          <template #header><h2 class="font-semibold text-highlighted">生成条件</h2></template>
          <pre class="content-pre">{{ 'content' in details.run.input ? details.run.input.content : details.run.input.requirement }}</pre>
          <div v-if="details.run.scene" class="mt-4 rounded-md bg-elevated p-3 text-sm">
            <p class="font-medium text-highlighted">临时场景</p>
            <pre class="content-pre mt-2">{{ JSON.stringify(details.run.scene, null, 2) }}</pre>
          </div>
        </UCard>

        <UCard v-if="details.run.result">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="font-semibold text-highlighted">兴趣判断结果</h2>
              <UBadge color="info" variant="subtle">AI 模拟推断，不是人物事实</UBadge>
            </div>
          </template>
          <div class="grid gap-3 sm:grid-cols-3">
            <div><p class="text-xs text-muted">结论</p><p class="mt-1 font-medium">{{ details.run.result.decision }}</p></div>
            <div><p class="text-xs text-muted">兴趣概率</p><p class="mt-1 font-medium">{{ Math.round(details.run.result.probability * 100) }}%</p></div>
            <div><p class="text-xs text-muted">置信度</p><p class="mt-1 font-medium">{{ Math.round(details.run.result.confidence * 100) }}%</p></div>
          </div>
          <p class="mt-4 text-sm">{{ details.run.result.reasoningSummary }}</p>
          <div class="mt-4 space-y-2"><p v-for="factor in details.run.result.factors" :key="factor.dimension" class="rounded-md bg-elevated p-3 text-sm"><strong>{{ factor.dimension }} {{ factor.score }}</strong>：{{ factor.explanation }}</p></div>
          <div v-if="details.run.result.unknowns.length" class="mt-4"><p class="text-sm font-medium">不确定项</p><ul class="mt-2 list-disc pl-5 text-sm text-muted"><li v-for="item in details.run.result.unknowns" :key="item">{{ item }}</li></ul></div>
        </UCard>

        <UAlert v-if="details.run.kind === 'artifact_generation' && active" color="info" title="正在生成最终内容" description="文章完成后会自动显示；如设置了图片，系统会继续根据文章生成指定数量配图。" />
        <UAlert v-if="artifactLoading" color="info" title="正在读取生成结果" />
        <UAlert v-else-if="artifactError" color="error" title="生成结果读取失败" :description="artifactError" :actions="[{ label: '重试', onClick: retryArtifactResult }]" />
        <GenerationArtifactResult
          v-else-if="artifactResult && artifactOutputFormat"
          :run-id="runId"
          :output-format="artifactOutputFormat"
          :result="artifactResult"
        />
      </div>

      <UCard v-if="selectedTab === 'evidence'">
        <template #header><div><h2 class="font-semibold text-highlighted">本次使用的设定与资料</h2><p class="mt-1 text-sm text-muted">任务创建时已固定保存，之后修改人物或资料不会改变这里的内容。</p></div></template>
        <GenerationEvidenceList
          :evidence="details.evidence"
          :supporting-evidence-ids="details.run.result?.supportingEvidenceIds ?? []"
          :opposing-evidence-ids="details.run.result?.opposingEvidenceIds ?? []"
        />
      </UCard>

      <UCard v-if="selectedTab === 'feedback'">
        <template #header><div><h2 class="font-semibold text-highlighted">运行反馈</h2><p class="mt-1 text-sm text-muted">原始反馈不会直接改写人物；确认“作为人物成长素材”后，仍需 AI 提炼、人工校准和发布。</p></div></template>
        <div class="space-y-5">
          <FeedbackForm :blocks="details.blocks" :loading="actionLoading" @submit="submitFeedback" />
          <template v-if="pendingFeedback.length">
            <div v-for="item in pendingFeedback" :key="item.id" class="border-t border-default pt-5">
              <p class="mb-3 whitespace-pre-wrap text-sm">{{ item.content }}</p>
              <FeedbackClassificationReview
                :feedback="item"
                :blocks="details.blocks"
                :sources="personaDetails?.sources ?? []"
                :loading="actionLoading"
                @confirm="confirmFeedback(item.id, $event)"
              />
            </div>
          </template>
          <div v-if="runFeedback.some(item => item.confirmedTarget !== null)" class="border-t border-default pt-5">
            <p class="mb-3 text-sm font-medium text-highlighted">已确认反馈</p>
            <ul class="space-y-2 text-sm">
              <li v-for="item in runFeedback.filter(value => value.confirmedTarget !== null)" :key="item.id" class="rounded-md bg-elevated p-3">
                <span class="whitespace-pre-wrap">{{ item.content }}</span>
                <UBadge class="ml-2" color="neutral" variant="subtle">{{ item.confirmedTarget }}</UBadge>
              </li>
            </ul>
          </div>
        </div>
      </UCard>

      <div v-if="selectedTab === 'settings'" class="space-y-6">
        <UCard v-if="details.run.promptContext">
          <template #header><div><h2 class="font-semibold text-highlighted">本次提示词用量</h2><p class="mt-1 text-sm text-muted">创建任务时已固定；后续修改设置不会改变本次结果。</p></div></template>
          <div class="space-y-4 text-sm">
            <div class="grid grid-cols-2 gap-3">
              <div><p class="text-xs text-muted">预计输入</p><p class="mt-1 font-medium">{{ details.run.promptContext.estimatedInputTokens }} Token</p></div>
              <div><p class="text-xs text-muted">可用输入</p><p class="mt-1 font-medium">{{ details.run.promptContext.availableInputTokens }} Token</p></div>
            </div>
            <dl class="space-y-2">
              <div><dt class="text-muted">世界</dt><dd>{{ details.run.promptContext.budgets.world.used }} / {{ details.run.promptContext.budgets.world.limit }}</dd></div>
              <div><dt class="text-muted">人物</dt><dd>{{ details.run.promptContext.budgets.persona.used }} / {{ details.run.promptContext.budgets.persona.limit }}</dd></div>
              <div><dt class="text-muted">参考资料</dt><dd>{{ details.run.promptContext.budgets.sources.used }} / {{ details.run.promptContext.budgets.sources.limit }}</dd></div>
              <div><dt class="text-muted">计算方式</dt><dd>{{ details.run.promptContext.tokenCountExact ? '模型精确计算' : '保守估算' }}</dd></div>
            </dl>
            <div>
              <p class="font-medium text-highlighted">已选入 {{ details.run.promptContext.selected.length }} 项</p>
              <ul v-if="details.run.promptContext.selected.length" class="mt-2 space-y-1 text-xs text-muted">
                <li v-for="item in details.run.promptContext.selected" :key="`selected-${item.category}-${item.entityId}-${item.contentHash}`">{{ promptCategoryLabel(item.category) }} · {{ item.estimatedTokens }} Token</li>
              </ul>
            </div>
            <div v-if="details.run.promptContext.skipped.length">
              <p class="font-medium text-highlighted">未选入 {{ details.run.promptContext.skipped.length }} 项</p>
              <ul class="mt-2 space-y-1 text-xs text-muted">
                <li v-for="item in details.run.promptContext.skipped" :key="`skipped-${item.category}-${item.entityId}-${item.contentHash}`">{{ promptCategoryLabel(item.category) }} · {{ skippedReasonLabel(item.skippedReason) }}</li>
              </ul>
            </div>
          </div>
        </UCard>
        <UCard>
          <template #header><div><h2 class="font-semibold text-highlighted">本次任务使用的设置</h2><p class="mt-1 text-sm text-muted">用于复查任务当时使用的人物版本、模型和生成限制。</p></div></template>
          <dl class="space-y-3 text-sm">
            <div><dt class="text-muted">人物版本</dt><dd class="break-all">{{ details.run.personaVersionId }}</dd></div>
            <div><dt class="text-muted">提示版本</dt><dd>{{ details.run.promptVersion }}</dd></div>
            <div v-if="details.run.imageModel"><dt class="text-muted">图片模型</dt><dd>{{ details.run.imageModel.model }}</dd></div>
            <div><dt class="text-muted">参数</dt><dd><pre class="content-pre">{{ JSON.stringify(details.run.parameters, null, 2) }}</pre></dd></div>
            <div><dt class="text-muted">完成时间</dt><dd>{{ formatTime(details.run.completedAt) }}</dd></div>
          </dl>
        </UCard>
        <UCard>
          <template #header><h2 class="font-semibold text-highlighted">固定人物版本快照</h2></template>
          <div v-if="personaVersion" class="space-y-4 text-sm">
            <div v-for="field in personaSnapshotFields" :key="field.label">
              <p class="text-xs text-muted">{{ field.label }}</p>
              <p class="mt-1 whitespace-pre-wrap">{{ field.value || '—' }}</p>
            </div>
          </div>
          <p v-else class="text-sm text-muted">人物版本快照加载失败。</p>
        </UCard>
        <UCard>
          <template #header><h2 class="font-semibold text-highlighted">关联资料</h2></template>
          <ul v-if="personaDetails?.sources.length" class="space-y-3 text-sm">
            <li v-for="source in personaDetails.sources" :key="source.id" class="rounded-md bg-elevated p-3">
              <NuxtLink :to="`/sources/${source.id}`" class="font-medium text-highlighted hover:underline">{{ source.name }}</NuxtLink>
              <p class="mt-1 text-xs text-muted">{{ source.role }} · {{ source.chunkCount }} 个内容段落</p>
            </li>
          </ul>
          <p v-else class="text-sm text-muted">该人物没有直接关联资料。</p>
        </UCard>
      </div>
    </template>
  </div>
</template>
