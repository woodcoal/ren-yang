<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import type { ConfirmFeedbackClassificationInput, FeedbackTarget } from '#shared/schemas/feedback'
import type { PersonaSnapshot, SourceSummary } from '#shared/types/content'
import type { FeedbackView } from '#shared/types/feedback'
import type { ArtifactBlockView } from '#shared/types/generation'

const props = withDefaults(defineProps<{
  /** 等待确认的反馈。 */
  feedback: FeedbackView
  /** 当前运行可重试块。 */
  blocks?: ArtifactBlockView[]
  /** 反馈运行所绑定的人物版本快照。 */
  personaSnapshot: PersonaSnapshot
  /** 可关联的资料列表。 */
  sources?: SourceSummary[]
  /** 父页面提交锁。 */
  loading?: boolean
}>(), { blocks: () => [], sources: () => [], loading: false })

const emit = defineEmits<{
  /** 用户确认或纠正后的完整目标动作。 */
  confirm: [input: ConfirmFeedbackClassificationInput]
}>()

/** 人物字段中文标签。 */
const personaFields: Array<{ value: keyof PersonaSnapshot, label: string }> = [
  { value: 'summary', label: '人物定位' },
  { value: 'identityFacts', label: '身份事实' },
  { value: 'interests', label: '兴趣偏好' },
  { value: 'valuesAndMotivations', label: '价值与动机' },
  { value: 'expressionStyle', label: '表达风格' },
  { value: 'appearance', label: '外观描述' },
  { value: 'visualStyle', label: '视觉风格' },
  { value: 'constraints', label: '约束与安全边界' },
]

/** 用户确认表单。 */
const form = reactive({
  targetType: props.feedback.suggestion.targetType as FeedbackTarget,
  blockId: props.feedback.blockId ?? '',
  sourceId: '',
  hasEvidenceConflict: false,
  field: 'expressionStyle' as keyof PersonaSnapshot,
  after: props.personaSnapshot.expressionStyle,
  reason: props.feedback.content,
})
const error = shallowRef<string | null>(null)
const confidenceLabel = computed(() => `${Math.round(props.feedback.suggestion.confidence * 100)}%`)

watch(() => form.field, (field) => { form.after = props.personaSnapshot[field] })

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
  if (form.targetType === 'persona' && (!form.after.trim() || !form.reason.trim())) {
    error.value = '长期人物修订必须填写修订后完整字段和理由'
    return
  }
  emit('confirm', {
    targetType: form.targetType,
    blockId: form.targetType === 'artifact' ? form.blockId : null,
    sourceId: form.targetType === 'source_fact' ? form.sourceId : null,
    hasEvidenceConflict: form.targetType === 'source_fact' || form.targetType === 'persona' ? form.hasEvidenceConflict : false,
    personaPatches: form.targetType === 'persona'
      ? [{ field: form.field, after: form.after.trim(), reason: form.reason.trim() }]
      : [],
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
    <UFormField label="确认反馈目标" required>
      <select v-model="form.targetType" class="native-control">
        <option value="artifact">当前产物</option>
        <option value="parameters">运行参数</option>
        <option value="persona">长期人物</option>
        <option value="source_fact">资料事实</option>
      </select>
    </UFormField>

    <UFormField v-if="form.targetType === 'artifact'" label="重试产物块" required>
      <select v-model="form.blockId" class="native-control">
        <option value="">请选择</option>
        <option v-for="block in props.blocks" :key="block.id" :value="block.id">{{ block.ordinal + 1 }} · {{ block.specKey }}</option>
      </select>
    </UFormField>

    <template v-if="form.targetType === 'persona'">
      <UAlert color="warning" title="长期变化不会直接覆盖当前人物" description="系统将创建不可变候选版本和修订提案，评测通过后仍按字段风险决定是否需要人工发布。" />
      <UFormField label="人物字段" required>
        <select v-model="form.field" class="native-control"><option v-for="field in personaFields" :key="field.value" :value="field.value">{{ field.label }}</option></select>
      </UFormField>
      <UFormField label="修订后的完整字段" required><UTextarea v-model="form.after" :rows="5" /></UFormField>
      <UFormField label="修订理由" required><UTextarea v-model="form.reason" :rows="3" /></UFormField>
      <UCheckbox v-model="form.hasEvidenceConflict" label="该变化与已有资料或原著事实存在冲突" />
    </template>

    <template v-if="form.targetType === 'source_fact'">
      <UFormField label="冲突资料" required>
        <select v-model="form.sourceId" class="native-control"><option value="">请选择</option><option v-for="source in props.sources" :key="source.id" :value="source.id">{{ source.name }}</option></select>
      </UFormField>
      <UCheckbox v-model="form.hasEvidenceConflict" label="确认存在事实冲突" />
    </template>

    <UAlert v-if="form.targetType === 'parameters'" color="neutral" title="只保存参数建议" description="本次确认不会修改人物，也不会原地修改已有参数方案。" />
    <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
    <UButton :loading="props.loading" @click="confirm">确认分类并执行对应动作</UButton>
  </div>
</template>
