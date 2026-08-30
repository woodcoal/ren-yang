<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive } from 'vue'
import { subjectInitializationSchema, type SubjectInitializationInput } from '#shared/schemas/content'

/** 快速创建弹窗属性。 */
interface Props {
  /** 当前初始化的对象类型。 */
  subjectType: 'persona' | 'world'
  /** AI 生成与业务创建请求是否正在执行。 */
  loading: boolean
  /** 服务端返回且可向用户展示的错误。 */
  errorMessage: string | null
}

const props = defineProps<Props>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{
  /** 用户确认后提交唯一自然语言输入。 */
  submit: [prompt: string]
}>()

/** 弹窗唯一可变输入；失败时不重置，便于用户直接修改。 */
const state = reactive<SubjectInitializationInput>({ prompt: '' })
const isPersona = computed(() => props.subjectType === 'persona')
const title = computed(() => {
  if (props.loading) return isPersona.value ? '正在创建人物' : '正在创建世界'
  return isPersona.value ? '快速创建人物' : '快速创建世界'
})
const description = computed(() => {
  if (props.loading) return '正在调用 AI 整理初始设定并保存待确认草稿。'
  return isPersona.value
    ? '写下人物的身份、性格、偏好、表达方式和行为边界。'
    : '写下世界的背景、核心规则、关键势力和整体风格。'
})
const fieldLabel = computed(() => isPersona.value ? '人物描述' : '世界描述')
const placeholder = computed(() => isPersona.value
  ? '例如：她是架空学院的年轻档案员，谨慎、重视证据，回答简短；遇到未知事实必须明确说明不知道。'
  : '例如：人类生活在浮空岛屿，依靠风帆船和受季风约束的航路往来，浮石能量决定岛屿稳定。')
const submitLabel = computed(() => isPersona.value ? '生成并创建人物' : '生成并创建世界')
const processingTitle = computed(() => isPersona.value ? 'AI 正在生成人物初始设定' : 'AI 正在生成世界初始设定')
const processingDestination = computed(() => isPersona.value ? '人物详情页' : '世界详情页')

/**
 * 把 Nuxt UI 已校验的自然语言描述交给列表页编排。
 * @param event 已通过共享 Schema 校验的表单提交事件。
 * @returns 无返回值。
 */
function handleSubmit(event: FormSubmitEvent<SubjectInitializationInput>): void {
  emit('submit', event.data.prompt)
}
</script>

<template>
  <UModal v-model:open="open" :title="title" :description="description" :dismissible="!loading" :close="!loading">
    <slot />
    <template #body>
      <UForm v-if="!loading" :schema="subjectInitializationSchema" :state="state" class="space-y-4" @submit="handleSubmit">
        <UFormField name="prompt" :label="fieldLabel" required>
          <UTextarea
            v-model="state.prompt"
            class="w-full"
            :rows="8"
            autoresize
            :maxrows="14"
            :placeholder="placeholder"
            :disabled="loading"
          />
        </UFormField>
        <UAlert
          color="neutral"
          variant="subtle"
          title="创建后仍是待确认草稿"
          description="AI 会自动整理名称、灵魂章节和运行摘要，但不会自动发布；进入详情后可以继续修改。"
        />
        <UAlert v-if="errorMessage" color="error" title="创建失败" :description="errorMessage" />
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" :disabled="loading" @click="open = false">取消</UButton>
          <UButton type="submit" icon="i-lucide-sparkles" :loading="loading">{{ submitLabel }}</UButton>
        </div>
      </UForm>
    </template>
  </UModal>

  <Teleport to="body">
    <div
      v-if="loading"
      data-subject-creation-overlay
      class="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-default/55 px-6 text-center backdrop-blur-md"
      role="status"
      aria-live="assertive"
      aria-busy="true"
    >
      <div class="relative mb-7 flex size-20 items-center justify-center" aria-hidden="true">
        <span class="absolute inset-0 animate-ping rounded-full bg-primary/20" />
        <UIcon data-subject-creation-spinner name="i-lucide-loader-circle" class="relative size-14 animate-spin text-primary" />
      </div>
      <strong class="text-xl text-highlighted">{{ processingTitle }}</strong>
      <p class="mt-3 max-w-lg text-sm leading-6 text-muted">生成和结构校验可能需要几十秒，请保持当前页面开启，不要重复提交。</p>
      <p class="mt-1 max-w-lg text-sm leading-6 text-muted">处理完成后会自动进入{{ processingDestination }}继续调整。</p>
    </div>
  </Teleport>
</template>
