<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { updateSystemAiSettingsSchema, type SystemAiSettingsValues } from '#shared/schemas/systemAi'
import OperationParameterFields from './OperationParameterFields.vue'

defineProps<{
  /** 保存请求是否正在执行。 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 用户提交且共享 Schema 校验通过后，交由页面执行保存。 */
  submit: [values: SystemAiSettingsValues]
}>()

const values = defineModel<SystemAiSettingsValues>({ required: true })

/**
 * 转发已校验的完整设置，确保保存不会产生隐式的局部继承。
 * @param event Nuxt UI 使用共享 Schema 校验后的表单提交事件。
 * @returns 无返回值；保存状态由页面组件维护。
 */
function handleSubmit(event: FormSubmitEvent<SystemAiSettingsValues>): void {
  emit('submit', event.data)
}
</script>

<template>
  <UForm :schema="updateSystemAiSettingsSchema" :state="values" class="space-y-5" data-system-ai-settings-form @submit="handleSubmit">
    <section class="archive-panel" aria-labelledby="interest-ai-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">人物判断</p>
          <h2 id="interest-ai-heading">兴趣分析</h2>
          <p>用于工作台“判断人物兴趣”，独立于结构化图文创作的生成设置。</p>
        </div>
      </div>
      <OperationParameterFields :model-value="values.interestAnalysis" name-prefix="interestAnalysis" />
      <UFormField
        name="interestAnalysis.maxEvidenceChunks"
        label="最多参考资料段落"
        description="控制兴趣判断最多检索多少段人物、成长、记忆和参考资料。"
        class="mt-4 max-w-md"
        required
      >
        <UInput v-model.number="values.interestAnalysis.maxEvidenceChunks" type="number" min="0" max="50" class="w-full" />
      </UFormField>
    </section>

    <section class="archive-panel" aria-labelledby="content-analysis-ai-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">内容提炼</p>
          <h2 id="content-analysis-ai-heading">记忆提炼</h2>
          <p>当前用于人物记忆提炼；灵魂和成长步骤的参数已迁移到 AI 算法页面。</p>
        </div>
      </div>
      <OperationParameterFields :model-value="values.contentAnalysis" name-prefix="contentAnalysis" />
    </section>

    <section class="archive-panel" aria-labelledby="draft-ai-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">快速建立对象</p>
          <h2 id="draft-ai-heading">草稿生成</h2>
          <p>用于根据自然语言生成人物草稿和世界草稿。</p>
        </div>
      </div>
      <OperationParameterFields :model-value="values.draftGeneration" name-prefix="draftGeneration" />
    </section>

    <section class="archive-panel" aria-labelledby="feedback-ai-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">结果归因</p>
          <h2 id="feedback-ai-heading">反馈分类</h2>
          <p>用于判断反馈应作用于产物、参数、资料还是人物成长。</p>
        </div>
      </div>
      <OperationParameterFields :model-value="values.feedbackClassification" name-prefix="feedbackClassification" />
    </section>

    <div class="sticky-action-bar">
      <p class="text-sm text-muted">保存后只影响新创建或新执行的 AI 操作，已有运行和分析批次继续使用原参数快照。</p>
      <UButton type="submit" size="lg" :loading="loading">保存系统 AI 设置</UButton>
    </div>
  </UForm>
</template>
