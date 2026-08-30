import { defineComponent, shallowRef } from 'vue'
import type { Component } from 'vue'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AiLoadingOverlay from '../../app/components/AiLoadingOverlay.vue'
import { useAiLoading } from '../../app/composables/useAiLoading'

/**
 * 创建可由测试控制结束时间的全局 AI 加载层宿主。
 * @returns 包含任务触发按钮和真实全局遮罩组件的 Vue 测试组件。
 */
function createLoadingHarness(): Component {
  return defineComponent({
    components: { AiLoadingOverlay },
    /** @returns 向模板公开 AI 任务的启动与完成动作。 */
    setup() {
      const { runWithAiLoading } = useAiLoading()
      const finishTask = shallowRef<(() => void) | null>(null)

      /** @returns 启动一个挂起的 AI 工作，直到测试显式完成它。 */
      async function startTask(): Promise<void> {
        await runWithAiLoading({
          title: 'AI 正在生成测试头像',
          description: '图片模型正在处理人物设定。',
          completionHint: '完成后会自动替换头像。',
        }, async () => await new Promise<void>((resolveTask) => {
          finishTask.value = resolveTask
        }))
      }

      /** @returns 完成当前挂起任务并清空测试回调。 */
      function completeTask(): void {
        finishTask.value?.()
        finishTask.value = null
      }

      return { startTask, completeTask }
    },
    template: '<div><button data-start-ai-task @click="startTask">开始</button><button data-complete-ai-task @click="completeTask">完成</button><AiLoadingOverlay /></div>',
  })
}

describe('全局 AI 加载层', () => {
  it('AI 工作期间使用 Nuxt UI 全屏模态层阻断操作并展示任务引导', async () => {
    const wrapper = await mountSuspended(createLoadingHarness())

    await wrapper.get('[data-start-ai-task]').trigger('click')
    await flushPromises()

    const overlay = document.querySelector<HTMLElement>('[data-ai-loading-overlay]')
    expect(overlay).not.toBeNull()
    expect(document.body.textContent).toContain('AI 正在生成测试头像')
    expect(document.body.textContent).toContain('请勿刷新页面或重复提交')
    expect(document.querySelector('[role="progressbar"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="close"]')).toBeNull()

    await new DOMWrapper(wrapper.get('[data-complete-ai-task]').element).trigger('click')
    await flushPromises()
    expect(document.querySelector('[data-ai-loading-overlay]')).toBeNull()
  })
})
