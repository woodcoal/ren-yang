<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import type { ArtifactFormat, DocumentSpec } from '#shared/schemas/generation'
import type { ConfirmFeedbackClassificationInput, SubmitFeedbackInput } from '#shared/schemas/feedback'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaDetails, PersonaSnapshot } from '#shared/types/content'
import type { FeedbackView } from '#shared/types/feedback'
import type { RenderedArtifactView, RunDetails } from '#shared/types/generation'
import { getApiErrorMessage } from '../../utils/apiError'

const route = useRoute()
const runId = String(route.params.id)
const { runWithAiLoading } = useAiLoading()
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
const draftSpec = computed(() => details.value?.documentSpecs.find(spec => spec.status === 'draft') ?? null)
const confirmedSpec = computed(() => details.value?.documentSpecs.find(spec => spec.status === 'confirmed') ?? null)
const artifactFormats = computed<ArtifactFormat[]>(() => confirmedSpec.value?.spec.requestedFormats ?? [])
const canRenderArtifact = computed(() => details.value?.blocks.some(block => block.selectedAttemptId) ?? false)
const runFeedback = computed(() => (feedbackData.value?.data ?? []).filter(item => item.runId === runId))
const pendingFeedback = computed(() => runFeedback.value.filter(item => item.confirmedTarget === null))
const personaDetails = computed(() => personaData.value?.data ?? null)
const personaVersion = computed(() => personaDetails.value?.versions.find(version => version.id === details.value?.run.personaVersionId) ?? null)
const personaSnapshotFields = computed(() => personaVersion.value ? toPersonaSnapshotFields(personaVersion.value.snapshot) : [])
const { notifySuccess, notifyError } = useOperationNotifications()
const actionLoading = shallowRef(false)
const pollingTimer = shallowRef<ReturnType<typeof setInterval> | null>(null)
const artifactPreview = shallowRef<RenderedArtifactView | null>(null)
const selectedTab = shallowRef<'result' | 'content' | 'evidence' | 'feedback' | 'settings'>('result')

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
// 等待规格确认时直接展示创作内容，避免用户进入页面后还要猜测应打开哪个标签。
watch(() => details.value?.run.status, (status) => {
  if (status === 'awaiting_confirmation') selectedTab.value = 'content'
}, { immediate: true })
onMounted(startPolling)
onUnmounted(stopPolling)

/** @param spec 已通过组件校验的文档规格。 @returns 保存一个新的不可变规格修订。 */
async function saveSpec(spec: DocumentSpec): Promise<void> {
  await executeAction('已保存新的规格修订', async () => {
    await $fetch(`/api/v1/runs/${runId}/document-spec`, { method: 'PUT', body: spec })
  })
}

/** @param spec 已通过组件校验的当前规格。 @returns 保存修订、确认规格并创建块执行任务。 */
async function confirmSpec(spec: DocumentSpec): Promise<void> {
  await executeAction('规格已确认，图文块已进入执行队列', async () => {
    await $fetch(`/api/v1/runs/${runId}/document-spec`, { method: 'PUT', body: spec })
    await runWithAiLoading({
      title: 'AI 正在准备生成图文内容',
      description: '系统正在确认内容规划并创建各图文块的生成任务。',
      completionHint: '任务进入队列后，详情页会持续显示每个图文块的处理状态。',
    }, async () => await $fetch(`/api/v1/runs/${runId}/document-spec/confirm`, { method: 'POST' }))
  })
}

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
      description: '系统正在复制固定输入与生成设置，并为失败内容创建新的运行任务。',
      completionHint: '重试任务建立后，详情页会继续显示处理进度。',
    }, async () => await $fetch(`/api/v1/runs/${runId}/retry`, { method: 'POST' }))
  })
}

/** @param blockId 目标块 UUID。 @returns 创建单块任务并刷新尝试历史。 */
async function retryBlock(blockId: string): Promise<void> {
  await executeAction('已创建单块重试任务', async () => {
    await runWithAiLoading({
      title: 'AI 正在准备重新生成内容块',
      description: '系统正在按当前锁定的规格为这个内容块创建新尝试。',
      completionHint: '新尝试建立后，当前内容块会持续显示处理状态。',
    }, async () => await $fetch(`/api/v1/runs/${runId}/blocks/${blockId}/attempts`, { method: 'POST' }))
  })
}

/** @param blockId 目标块 UUID。 @param attemptId 历史成功尝试 UUID。 @returns 切换当前选择并刷新详情。 */
async function selectBlockAttempt(blockId: string, attemptId: string): Promise<void> {
  await executeAction('已切换当前选中尝试', async () => {
    await $fetch(`/api/v1/runs/${runId}/blocks/${blockId}/select`, { method: 'POST', body: { attemptId } })
  })
}

/** @param blockId 目标块 UUID。 @param locked 新锁定状态。 @returns 更新锁定状态并刷新详情。 */
async function setBlockLock(blockId: string, locked: boolean): Promise<void> {
  await executeAction(locked ? '已锁定当前结果' : '已解除块锁定', async () => {
    await $fetch(`/api/v1/runs/${runId}/blocks/${blockId}/lock`, { method: 'POST', body: { locked } })
  })
}

/** @returns 从服务端按同一组选中尝试生成全部允许格式的安全预览。 */
async function renderArtifact(): Promise<void> {
  if (actionLoading.value || artifactFormats.value.length === 0) return
  actionLoading.value = true
  try {
    const response = await $fetch<ApiResponse<RenderedArtifactView>>(`/api/v1/runs/${runId}/render`, {
      method: 'POST', body: { formats: artifactFormats.value },
    })
    artifactPreview.value = response.data
    notifySuccess('已根据当前选中结果生成预览。', '产物预览已生成')
  }
  catch (requestError: unknown) {
    notifyError(getApiErrorMessage(requestError, '产物预览失败'), '产物预览失败')
  }
  finally {
    actionLoading.value = false
  }
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

/** @param feedbackId 反馈 UUID。 @param input 用户确认后的分类动作。 @returns 执行动作并刷新运行、人物和反馈。 */
async function confirmFeedback(feedbackId: string, input: ConfirmFeedbackClassificationInput): Promise<void> {
  const successMessage = input.targetType === 'persona'
    ? '反馈已加入人物成长素材池，尚未改变当前提示词'
    : '反馈分类已确认，对应动作已执行'
  await executeAction(successMessage, async () => {
    await $fetch(`/api/v1/feedback/${feedbackId}/classify`, { method: 'POST', body: input })
    await Promise.all([refreshFeedback(), refreshPersona()])
  })
}

/** @param successMessage 操作成功通知。 @param action 单次写操作。 @returns 统一处理提交锁、通知和详情刷新。 */
async function executeAction(successMessage: string, action: () => Promise<void>): Promise<void> {
  if (actionLoading.value) return
  actionLoading.value = true
  try {
    await action()
    artifactPreview.value = null
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
      :title="details ? `${details.run.personaName} · ${details.run.kind === 'interest_assessment' ? '兴趣判断' : '图文创作'}` : '任务详情'"
      description="跟踪当前运行位置，审阅结果和图文内容，并追溯这次任务锁定的设定、资料与参数。"
    >
      <UButton to="/history" color="neutral" variant="ghost">返回历史</UButton>
    </ContentPageHeader>

    <UAlert v-if="error || !details" color="error" title="运行详情加载失败" :actions="[{ label: '重试', onClick: () => refresh() }]" />
    <template v-else>
      <GenerationRunStatusPanel :run="details.run" :tasks="details.tasks" :loading="actionLoading" @cancel="cancelRun" @retry="retryRun" />
      <nav class="mind-tabs my-6" aria-label="任务详情标签">
        <button class="mind-tab" :aria-selected="selectedTab === 'result'" @click="selectedTab = 'result'">结果</button>
        <button class="mind-tab" :aria-selected="selectedTab === 'content'" @click="selectedTab = 'content'">创作内容</button>
        <button class="mind-tab" :aria-selected="selectedTab === 'evidence'" @click="selectedTab = 'evidence'">使用依据</button>
        <button class="mind-tab" :aria-selected="selectedTab === 'feedback'" @click="selectedTab = 'feedback'">反馈学习</button>
        <button class="mind-tab" :aria-selected="selectedTab === 'settings'" @click="selectedTab = 'settings'">运行设置</button>
      </nav>

      <div>
        <div class="space-y-6">
          <UCard v-if="selectedTab === 'result'">
            <template #header><h2 class="font-semibold text-highlighted">固定输入</h2></template>
            <pre class="content-pre">{{ 'content' in details.run.input ? details.run.input.content : details.run.input.requirement }}</pre>
            <div v-if="details.run.scene" class="mt-4 rounded-md bg-elevated p-3 text-sm">
              <p class="font-medium text-highlighted">临时场景</p><pre class="content-pre mt-2">{{ JSON.stringify(details.run.scene, null, 2) }}</pre>
            </div>
          </UCard>
          <UCard v-if="selectedTab === 'result' && details.run.promptContext">
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

          <UCard v-if="selectedTab === 'result' && details.run.result">
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

          <UCard v-if="selectedTab === 'content' && draftSpec && details.run.status === 'awaiting_confirmation'">
            <template #header><div><h2 class="font-semibold text-highlighted">确认内容规划</h2><p class="mt-1 text-sm text-muted">这是第 {{ draftSpec.revision }} 版规划，确认前不会正式生成图文内容。</p></div></template>
            <GenerationDocumentSpecEditor
              :spec="draftSpec.spec"
              :allow-images="'includeImages' in details.run.input && details.run.input.includeImages"
              :loading="actionLoading"
              @save="saveSpec"
              @confirm="confirmSpec"
            />
          </UCard>

          <UCard v-if="selectedTab === 'content' && details.blocks.length">
            <template #header><h2 class="font-semibold text-highlighted">产物图文块</h2></template>
            <div class="space-y-4">
              <GenerationArtifactBlockCard
                v-for="block in details.blocks"
                :key="block.id"
                :run-id="runId"
                :block="block"
                :max-attempts="details.run.parameters.maxBlockAttempts"
                :loading="actionLoading"
                :actions-disabled="active"
                @retry="retryBlock(block.id)"
                @select="selectBlockAttempt(block.id, $event)"
                @lock="setBlockLock(block.id, $event)"
              />
            </div>
          </UCard>

          <GenerationArtifactPreview
            v-if="selectedTab === 'content' && confirmedSpec && canRenderArtifact"
            :run-id="runId"
            :formats="artifactFormats"
            :preview="artifactPreview"
            :loading="actionLoading"
            @render="renderArtifact"
          />

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
        </div>

        <div v-if="selectedTab === 'settings'" class="mt-6 space-y-6">
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
          <UCard v-if="details.documentSpecs.length > 1">
            <template #header><h2 class="font-semibold text-highlighted">规格修订历史</h2></template>
            <div class="space-y-2 text-sm"><p v-for="spec in details.documentSpecs" :key="spec.id">v{{ spec.revision }} · {{ spec.status }} · {{ formatTime(spec.createdAt) }}</p></div>
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
      </div>
    </template>
  </div>
</template>
