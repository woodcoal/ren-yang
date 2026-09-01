<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { CreateGenerationRunInput } from '#shared/schemas/generation'
import type { PersonaSummary } from '#shared/types/content'

const props = defineProps<{
  /** 当前可以参与新创作的已启用人物。 */
  personas: PersonaSummary[]
  /** 当前是否已配置图片模型。 */
  imageConfigured: boolean
  /** 父页面是否正在提交运行。 */
  loading?: boolean
}>()

const emit = defineEmits<{
  /** 提交完整且无需后续确认的一次直出创作条件。 */
  submit: [input: CreateGenerationRunInput]
}>()

const form = reactive({
  personaId: '',
  requirement: '',
  outputFormat: 'text' as 'html' | 'text',
  imageCount: 0,
})
const canSubmit = computed(() => Boolean(form.personaId && form.requirement.trim() && !props.loading))

watch(() => props.imageConfigured, (configured) => {
  if (!configured) form.imageCount = 0
})

/** @returns 向父页面提交去除首尾空白的完整创作条件。 */
function submit(): void {
  if (!canSubmit.value) return
  emit('submit', {
    personaId: form.personaId,
    requirement: form.requirement.trim(),
    outputFormat: form.outputFormat,
    imageCount: form.imageCount,
  })
}
</script>

<template>
  <form class="space-y-6" @submit.prevent="submit">
    <section class="workflow-panel" aria-labelledby="artifact-generation-heading">
      <div class="section-heading">
        <div class="section-heading-copy">
          <p class="eyebrow">直接生成</p>
          <h2 id="artifact-generation-heading">说明要生成什么</h2>
          <p>系统会按人物个性和创作条件直接生成最终文章，不再经过大纲或规格确认。</p>
        </div>
      </div>
      <div class="grid gap-4 md:grid-cols-2">
        <UFormField label="人物" required>
          <select v-model="form.personaId" class="native-control" aria-label="使用的人物" required>
            <option value="" disabled>请选择人物</option>
            <option v-for="persona in personas" :key="persona.id" :value="persona.id">{{ persona.name }}</option>
          </select>
        </UFormField>
        <UFormField label="输出格式" required>
          <select v-model="form.outputFormat" class="native-control" aria-label="输出格式">
            <option value="text">文本</option>
            <option value="html">HTML 图文混排</option>
          </select>
        </UFormField>
        <UFormField label="图片数量" :description="imageConfigured ? '图片会在文章完成后根据正文生成。' : '图片模型未配置，只能生成纯文本。'">
          <select v-model.number="form.imageCount" class="native-control" aria-label="图片数量" :disabled="!imageConfigured">
            <option :value="0">不生成图片</option>
            <option v-for="count in 4" :key="count" :value="count">{{ count }} 张</option>
          </select>
        </UFormField>
        <UFormField label="生成条件" required class="md:col-span-2">
          <UTextarea
            v-model="form.requirement"
            :rows="9"
            class="w-full"
            required
            placeholder="说明主题、受众、篇幅、重点和表达要求"
          />
        </UFormField>
      </div>
    </section>

    <div class="sticky-action-bar">
      <p class="text-sm text-muted">提交后直接生成最终文章；图片数量大于 0 时继续生成对应配图。</p>
      <UButton type="submit" size="lg" :disabled="!canSubmit" :loading="loading">开始生成</UButton>
    </div>
  </form>
</template>
