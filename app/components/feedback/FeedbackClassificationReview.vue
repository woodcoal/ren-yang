<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import type { ConfirmFeedbackClassificationInput, FeedbackTarget } from '#shared/schemas/feedback'
import type { SourceSummary } from '#shared/types/content'
import type { FeedbackView } from '#shared/types/feedback'
import type { ArtifactBlockView } from '#shared/types/generation'

const props = withDefaults(defineProps<{
  /** 等待确认的反馈。 */
  feedback: FeedbackView
  /** 当前运行可重试块。 */
  blocks?: ArtifactBlockView[]
  /** 可关联的资料列表。 */
  sources?: SourceSummary[]
  /** 父页面提交锁。 */
  loading?: boolean
}>(), { blocks: () => [], sources: () => [], loading: false })

const emit = defineEmits<{
  /** 用户确认或纠正后的完整目标动作。 */
  confirm: [input: ConfirmFeedbackClassificationInput]
}>()

/** 用户确认表单。 */
const form = reactive({
  targetType: props.feedback.suggestion.targetType as FeedbackTarget,
  blockId: props.feedback.blockId ?? '',
  sourceId: '',
  hasEvidenceConflict: false,
})
const error = shallowRef<string | null>(null)
const confidenceLabel = computed(() => `${Math.round(props.feedback.suggestion.confidence * 100)}%`)

/** @returns 校验目标专属输入并发出确认意图。 */
function confirm(): void {
  error.value = null
  if (form.targetType === 'artifact' && !form.blockId) {
    error.value = '当前产物反馈必须选择具体产物块'
    return
  }
  if (form.targetType === 'source_fact' && !form.sourceId) {
    error.value = '资料事实反馈必须选择资料'
    return
  }
  emit('confirm', {
    targetType: form.targetType,
    blockId: form.targetType === 'artifact' ? form.blockId : null,
    sourceId: form.targetType === 'source_fact' ? form.sourceId : null,
    hasEvidenceConflict: form.targetType === 'source_fact' ? form.hasEvidenceConflict : false,
  })
}
</script>

<template>
  <div class="space-y-4">
    <UAlert
      color="info"
      title="AI 分类建议"
      :description="`${props.feedback.suggestion.rationale}（置信度 ${confidenceLabel}）`"
    />
    <UFormField label="确认反馈用途" required>
      <select v-model="form.targetType" class="native-control">
        <option value="artifact">只修正当前产物</option>
        <option value="parameters">记录运行参数建议</option>
        <option value="persona">作为人物成长素材</option>
        <option value="source_fact">记录资料事实问题</option>
      </select>
    </UFormField>

    <UFormField v-if="form.targetType === 'artifact'" label="重试产物块" required>
      <select v-model="form.blockId" class="native-control">
        <option value="">请选择</option>
        <option v-for="block in props.blocks" :key="block.id" :value="block.id">{{ block.ordinal + 1 }} · {{ block.specKey }}</option>
      </select>
    </UFormField>

    <UAlert
      v-if="form.targetType === 'persona'"
      color="warning"
      title="确认后加入人物成长素材池"
      description="反馈会以默认 3 分作为独立素材；之后可调整评分并由 AI 提炼完整草稿，人工校准发布后才会进入新任务。不会直接修改人物灵魂或记忆。"
    />

    <template v-if="form.targetType === 'source_fact'">
      <UFormField label="存在问题的资料" required>
        <select v-model="form.sourceId" class="native-control"><option value="">请选择</option><option v-for="source in props.sources" :key="source.id" :value="source.id">{{ source.name }}</option></select>
      </UFormField>
      <UCheckbox v-model="form.hasEvidenceConflict" label="确认与现有事实存在冲突" />
    </template>

    <UAlert v-if="form.targetType === 'parameters'" color="neutral" title="只保存参数建议" description="本次确认不会修改人物，也不会原地修改已有生成设置。" />
    <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
    <UButton :loading="props.loading" @click="confirm">确认用途并执行</UButton>
  </div>
</template>
