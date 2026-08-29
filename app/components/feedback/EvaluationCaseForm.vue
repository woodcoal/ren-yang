<script setup lang="ts">
import { reactive, shallowRef } from 'vue'
import type { CreateEvaluationCaseInput } from '#shared/schemas/feedback'

const props = withDefaults(defineProps<{
  /** 父页面提交锁。 */
  loading?: boolean
}>(), { loading: false })

const emit = defineEmits<{
  /** 新建固定评测用例。 */
  submit: [input: CreateEvaluationCaseInput]
}>()

/** 用例编辑状态；词项用每行一项输入。 */
const form = reactive({
  name: '',
  category: 'behavior' as CreateEvaluationCaseInput['category'],
  prompt: '',
  expectedChange: 'retain' as CreateEvaluationCaseInput['expectedChange'],
  requiredTerms: '',
  forbiddenTerms: '',
  minimumScore: 0.7,
  maxRegression: 0.1,
})
const error = shallowRef<string | null>(null)

/** @returns 校验基础字段并发出结构化用例。 */
function submit(): void {
  error.value = null
  if (!form.name.trim() || !form.prompt.trim()) {
    error.value = '用例名称和固定输入不能为空'
    return
  }
  emit('submit', {
    name: form.name.trim(),
    category: form.category,
    prompt: form.prompt.trim(),
    expectedChange: form.expectedChange,
    requiredTerms: splitTerms(form.requiredTerms),
    forbiddenTerms: splitTerms(form.forbiddenTerms),
    minimumScore: Number(form.minimumScore),
    maxRegression: Number(form.maxRegression),
  })
}

/** @param value 每行一项的词项文本。 @returns 去空白和去重后的词项。 */
function splitTerms(value: string): string[] {
  return [...new Set(value.split(/\r?\n/u).map(item => item.trim()).filter(Boolean))]
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <div class="grid gap-4 md:grid-cols-2">
      <UFormField label="用例名称" required><UInput v-model="form.name" /></UFormField>
      <UFormField label="类别" required><select v-model="form.category" class="native-control"><option value="behavior">行为</option><option value="style">风格</option><option value="safety">安全</option></select></UFormField>
    </div>
    <UFormField label="固定场景或任务输入" required><UTextarea v-model="form.prompt" :rows="3" /></UFormField>
    <div class="grid gap-4 md:grid-cols-2">
      <UFormField label="变化预期"><select v-model="form.expectedChange" class="native-control"><option value="retain">不得明显退化</option><option value="improve">候选必须改善</option></select></UFormField>
      <UFormField label="最低候选评分"><UInput v-model.number="form.minimumScore" type="number" min="0" max="1" step="0.05" /></UFormField>
      <UFormField label="必需词（每行一项）"><UTextarea v-model="form.requiredTerms" :rows="3" /></UFormField>
      <UFormField label="禁用词（每行一项）"><UTextarea v-model="form.forbiddenTerms" :rows="3" /></UFormField>
      <UFormField label="最大允许退化"><UInput v-model.number="form.maxRegression" type="number" min="0" max="1" step="0.05" /></UFormField>
    </div>
    <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
    <UButton type="submit" :loading="props.loading">添加固定用例</UButton>
  </form>
</template>
