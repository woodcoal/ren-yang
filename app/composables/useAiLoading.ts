import { computed, readonly } from 'vue'

/** 单次 AI 工作在全局加载层展示的引导信息。 */
export interface AiLoadingTask {
  /** 明确说明当前模型正在执行的工作。 */
  title: string
  /** 解释当前阶段及可能需要等待的原因。 */
  description: string
  /** 告知用户请求完成后界面将发生什么。 */
  completionHint: string
}

/** 全局 AI 工作的默认引导信息，仅在调用方未提供专用文案时使用。 */
const DEFAULT_AI_LOADING_TASK: AiLoadingTask = {
  title: 'AI 正在处理任务',
  description: '模型正在分析当前内容，处理时间可能需要几十秒。',
  completionHint: '完成后页面会自动更新，请保持当前页面开启。',
}

/**
 * 提供全局 AI 加载状态和带完整清理语义的任务执行入口。
 * @returns 只读加载状态、当前引导信息，以及执行 AI 异步工作的统一方法。
 * @remarks 使用 Nuxt useState 保证同一次 SSR 请求隔离，并允许任意页面与全局遮罩共享状态。
 */
export function useAiLoading() {
  const activeTaskCount = useState<number>('ai-loading-active-task-count', () => 0)
  const currentTask = useState<AiLoadingTask>('ai-loading-current-task', () => ({ ...DEFAULT_AI_LOADING_TASK }))
  /** 只由活动任务数量派生，避免遮罩显示状态与任务生命周期分离。 */
  const isLoading = computed(() => activeTaskCount.value > 0)

  /**
   * 在不可关闭的全局遮罩保护下执行一次 AI 异步工作。
   * @param task 当前工作对应的用户引导信息。
   * @param action 实际调用模型或创建模型任务的异步函数。
   * @returns 原异步函数的返回结果。
   * @remarks 并发任务通过计数管理；仅当最后一个任务结束时才解除整页遮罩。
   */
  async function runWithAiLoading<Result>(task: AiLoadingTask, action: () => Promise<Result>): Promise<Result> {
    currentTask.value = task
    activeTaskCount.value += 1
    try {
      return await action()
    }
    finally {
      activeTaskCount.value = Math.max(0, activeTaskCount.value - 1)
    }
  }

  return {
    isLoading,
    currentTask: readonly(currentTask),
    runWithAiLoading,
  }
}
