<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive } from 'vue'
import { generatePersonaDraftSchema, type GeneratePersonaDraftInput } from '#shared/schemas/content'
import type { SourceSummary, WorldSummary } from '#shared/types/content'

/** 人物草稿助手属性。 */
interface Props {
  /** 可选世界。 */
  worlds: WorldSummary[]
  /** 可选参考资料。 */
  sources: SourceSummary[]
  /** 文本模型是否已经配置。 */
  textModelConfigured: boolean
  /** 当前是否正在请求模型。 */
  loading: boolean
  /** 服务端返回的安全错误消息。 */
  errorMessage: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 请求把当前自然语言和参考上下文整理为结构化草稿。 */
  generate: [input: GeneratePersonaDraftInput]
}>()

/** 草稿生成器唯一可变输入状态。 */
const state = reactive<GeneratePersonaDraftInput>({
  prompt: '',
  origin: 'original',
  worldId: null,
  sourceIds: [],
})

/** 只有启用且当前灵魂完整的世界才能作为模型事实上下文。 */
const availableWorlds = computed(() => props.worlds.filter(world => world.isEnabled && world.activeVersionId))

/**
 * 上送 Nuxt UI 已通过共享 Schema 校验的草稿生成输入。
 * @param event 表单提交事件。
 * @returns 无返回值。
 */
function handleSubmit(event: FormSubmitEvent<GeneratePersonaDraftInput>): void {
  emit('generate', event.data)
}
</script>

<template>
  <section class="workflow-panel" aria-labelledby="persona-draft-heading">
    <div class="section-heading">
      <div class="section-heading-copy">
        <p class="eyebrow">建立方式与参考</p>
        <h2 id="persona-draft-heading">用自然语言整理人物初稿</h2>
        <p>AI 只生成可编辑草稿，不会自动保存或发布；你的明确描述始终高于参考资料。</p>
      </div>
    </div>

    <UAlert v-if="!textModelConfigured" class="mb-5" color="warning" title="文本模型未配置"
      description="仍可在下方手工填写；配置 OpenAI-compatible 文本模型并重启后可使用 AI 整理。" />
    <UAlert v-if="errorMessage" class="mb-5" color="error" title="草稿生成失败" :description="errorMessage" />

    <UForm :schema="generatePersonaDraftSchema" :state="state" class="space-y-5" @submit="handleSubmit">
      <UFormField name="prompt" label="自然语言人设" required>
        <UTextarea v-model="state.prompt" class="w-full" :rows="6" :disabled="loading"
          placeholder="例如：她是架空学院的年轻档案员，谨慎、重视证据，回答简短；遇到未知事实必须明确说明不知道。" />
      </UFormField>
      <div class="grid gap-5 md:grid-cols-3">
        <UFormField name="origin" label="来源模式" required>
          <USelect v-model="state.origin" class="w-full" :items="[
            { label: '原创', value: 'original' },
            { label: '资料型', value: 'source_based' },
            { label: '混合型', value: 'hybrid' },
          ]" :disabled="loading" />
        </UFormField>
        <UFormField name="worldId" label="可用世界（可选）">
          <select v-model="state.worldId" class="native-control" :disabled="loading">
            <option :value="null">不使用世界</option>
            <option v-for="world in availableWorlds" :key="world.id" :value="world.id">{{ world.name }}</option>
          </select>
        </UFormField>
        <UFormField name="sourceIds" label="参考资料（最多 8 项）">
          <select v-model="state.sourceIds" class="native-control min-h-28" multiple :disabled="loading">
            <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
          </select>
        </UFormField>
      </div>
      <UButton type="submit" icon="i-lucide-sparkles" :loading="loading" :disabled="!textModelConfigured">
        生成并填入下方表单
      </UButton>
    </UForm>
  </section>
</template>
