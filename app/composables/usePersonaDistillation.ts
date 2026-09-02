import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'
import type {
  ConfirmPersonaDistillationCandidateInput,
  ReviewPersonaDistillationSourcesInput,
  SavePersonaDistillationCandidateInput,
} from '#shared/schemas/personaDistillation'
import type { ApiResponse } from '#shared/types/api'
import type { PersonaDistillationRunView } from '#shared/types/personaDistillation'
import { getApiErrorMessage } from '../utils/apiError'

/**
 * 管理单个人物蒸馏工作区的读取、轮询和全部用户动作。
 * @param runId 当前人物蒸馏运行 UUID。
 * @returns 当前运行、请求状态以及覆盖确认、重评、确认、取消和重试动作。
 */
export async function usePersonaDistillation(runId: string) {
  const { notifySuccess, notifyError } = useOperationNotifications()
  const fetchResult = useFetch<ApiResponse<PersonaDistillationRunView>>(`/api/v1/persona-distillations/${runId}`, {
    // 人工检查点可能在另一标签页发生变化，进入工作区时不能复用旧运行缓存。
    getCachedData: () => undefined,
  })
  const { data, error, refresh } = fetchResult
  const run = computed(() => data.value?.data ?? null)
  const actionLoading = shallowRef(false)
  const pollingTimer = shallowRef<ReturnType<typeof setInterval> | null>(null)
  const active = computed(() => run.value
    ? ['assessing_sources', 'extracting', 'synthesizing', 'evaluating'].includes(run.value.status)
    : false)

  /**
   * 启动每两秒一次的活动运行轮询；已有计时器或当前为人工检查点时不重复启动。
   * @returns 无返回值。
   */
  function startPolling(): void {
    if (!import.meta.client || pollingTimer.value || !active.value) return
    pollingTimer.value = setInterval(() => { void refresh() }, 2_000)
  }

  /**
   * 停止人物蒸馏轮询并释放计时器。
   * @returns 无返回值。
   */
  function stopPolling(): void {
    if (!pollingTimer.value) return
    clearInterval(pollingTimer.value)
    pollingTimer.value = null
  }

  /**
   * 页面挂载后重新读取一次服务端事实，避免同一路由缓存掩盖另一标签页完成的人工动作。
   * @returns 无返回值。
   */
  function refreshOnMounted(): void {
    void refresh().then(startPolling)
  }

  /**
   * 串行执行一次人物蒸馏写操作，统一刷新数据和展示错误。
   * @param successMessage 操作成功后展示的消息。
   * @param fallbackMessage 无稳定接口消息时使用的错误说明。
   * @param action 实际请求函数。
   * @returns 请求成功时返回接口中的最新运行，重复点击或失败时返回 null。
   */
  async function executeAction(
    successMessage: string,
    fallbackMessage: string,
    action: () => Promise<ApiResponse<PersonaDistillationRunView>>,
  ): Promise<PersonaDistillationRunView | null> {
    if (actionLoading.value) return null
    actionLoading.value = true
    try {
      const response = await action()
      await refresh()
      notifySuccess(successMessage)
      return response.data
    }
    catch (requestError: unknown) {
      notifyError(getApiErrorMessage(requestError, fallbackMessage), fallbackMessage)
      return null
    }
    finally {
      actionLoading.value = false
    }
  }

  /**
   * 确认资料范围和分类纠正并启动认知提取。
   * @param input 当前页面版本、接受资料和分类纠正。
   * @returns 操作完成时结束。
   */
  async function reviewSources(input: ReviewPersonaDistillationSourcesInput): Promise<void> {
    await executeAction('资料范围已确认，正在提炼人物认知', '资料确认失败', async () => await $fetch(
      `/api/v1/persona-distillations/${runId}/source-review`,
      { method: 'POST', body: input },
    ))
  }

  /**
   * 保存人工编辑后的完整候选并启动新一轮评测。
   * @param input 当前页面版本和完整候选正文。
   * @returns 操作完成时结束。
   */
  async function saveCandidate(input: SavePersonaDistillationCandidateInput): Promise<void> {
    await executeAction('候选已保存，正在重新评测', '候选保存失败', async () => await $fetch(
      `/api/v1/persona-distillations/${runId}/candidate`,
      { method: 'PUT', body: input },
    ))
  }

  /**
   * 确认当前评测哈希对应的候选并原子创建人物。
   * @param input 当前页面版本、最终名称和候选哈希。
   * @returns 创建成功后的完整运行，失败或重复点击时返回 null。
   */
  async function confirmCandidate(input: ConfirmPersonaDistillationCandidateInput): Promise<PersonaDistillationRunView | null> {
    return await executeAction('人物与初始灵魂已经创建', '人物确认失败', async () => await $fetch(
      `/api/v1/persona-distillations/${runId}/confirm`,
      { method: 'POST', body: input },
    ))
  }

  /**
   * 请求协作式取消当前人物蒸馏运行。
   * @returns 操作完成时结束。
   */
  async function cancelRun(): Promise<void> {
    await executeAction('取消请求已提交', '人物蒸馏取消失败', async () => await $fetch(
      `/api/v1/persona-distillations/${runId}/cancel`,
      { method: 'POST' },
    ))
  }

  /**
   * 从失败运行的固定输入和算法快照创建新运行。
   * @returns 新运行，失败或重复点击时返回 null。
   */
  async function retryRun(): Promise<PersonaDistillationRunView | null> {
    return await executeAction('已创建新的人物蒸馏运行', '人物蒸馏重试失败', async () => await $fetch(
      `/api/v1/persona-distillations/${runId}/retry`,
      { method: 'POST' },
    ))
  }

  watch(active, value => value ? startPolling() : stopPolling())
  onMounted(refreshOnMounted)
  onUnmounted(stopPolling)
  await fetchResult

  return {
    run,
    error,
    active,
    actionLoading,
    refresh,
    reviewSources,
    saveCandidate,
    confirmCandidate,
    cancelRun,
    retryRun,
  }
}
