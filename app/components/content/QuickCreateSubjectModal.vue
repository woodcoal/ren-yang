<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, watch } from 'vue'
import { quickCreateSubjectSchema, type QuickCreateSubjectInput } from '#shared/schemas/content'

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
  /** 用户确认后提交名称、灵魂提示词和可选 AI 整理方式。 */
  submit: [input: QuickCreateSubjectInput]
}>()

/** 弹窗唯一表单状态；请求失败时保持原值，关闭后重新打开才清空。 */
const state = reactive<QuickCreateSubjectInput>({ name: '', promptText: '', autoAnalyze: false })
const isPersona = computed(() => props.subjectType === 'persona')
const title = computed(() => {
  if (props.loading) return isPersona.value ? '正在创建人物' : '正在创建世界'
  return isPersona.value ? '快速创建人物' : '快速创建世界'
})
const description = computed(() => {
  if (props.loading) return state.autoAnalyze ? '正在调用 AI 整理灵魂提示词并创建对象。' : '正在保存原始灵魂提示词。'
  return isPersona.value
    ? '填写人物名称和完整灵魂提示词；是否交给 AI 整理由你决定。'
    : '填写世界名称和完整灵魂提示词；是否交给 AI 整理由你决定。'
})
const nameLabel = computed(() => isPersona.value ? '人物名称' : '世界名称')
const namePlaceholder = computed(() => isPersona.value ? '例如：林默' : '例如：浮岛纪元')
const fieldLabel = computed(() => isPersona.value ? '人物灵魂提示词' : '世界灵魂提示词')
const placeholder = computed(() => isPersona.value
  ? '她是架空学院的年轻档案员，谨慎、重视证据，回答简短；遇到未知事实必须明确说明不知道。'
  : '人类生活在浮空岛屿，依靠风帆船和受季风约束的航路往来，浮石能量决定岛屿稳定。')
const submitLabel = computed(() => {
  const action = state.autoAnalyze ? 'AI 整理并创建' : '直接创建'
  return `${action}${isPersona.value ? '人物' : '世界'}`
})
const processingTitle = computed(() => {
  if (!state.autoAnalyze) return isPersona.value ? '正在创建人物' : '正在创建世界'
  return isPersona.value ? 'AI 正在整理人物灵魂' : 'AI 正在整理世界灵魂'
})
const processingDestination = computed(() => isPersona.value ? '人物详情页' : '世界详情页')

/**
 * 清空一次已经关闭的快速创建表单。
 * @returns 无返回值。
 */
function resetState(): void {
  state.name = ''
  state.promptText = ''
  state.autoAnalyze = false
}

/**
 * 把 Nuxt UI 已校验的快速创建输入交给列表页编排。
 * @param event 已通过共享 Schema 校验的表单提交事件。
 * @returns 无返回值。
 */
function handleSubmit(event: FormSubmitEvent<QuickCreateSubjectInput>): void {
  emit('submit', event.data)
}

watch(open, (isOpen, wasOpen) => {
  if (isOpen && wasOpen === false) resetState()
})
</script>

<template>
  <UModal v-model:open="open" :title="title" :description="description" :dismissible="!loading" :close="!loading">
    <slot />
    <template #body>
      <UForm v-if="!loading" :schema="quickCreateSubjectSchema" :state="state" class="space-y-4" data-quick-create-form @submit="handleSubmit">
        <UFormField name="name" :label="nameLabel" required>
          <UInput v-model="state.name" class="w-full" :placeholder="namePlaceholder" :disabled="loading" />
        </UFormField>
        <UFormField name="promptText" :label="fieldLabel" description="不勾选 AI 整理时，系统会按原文保存。" required>
          <UTextarea
            v-model="state.promptText"
            class="w-full"
            :rows="8"
            autoresize
            :maxrows="14"
            :placeholder="placeholder"
            :disabled="loading"
          />
        </UFormField>
        <UCheckbox v-model="state.autoAnalyze" data-quick-create-auto-analyze label="使用 AI 分析并整理为标准提示词" :disabled="loading" />
        <UAlert
          color="neutral"
          variant="subtle"
          title="创建后立即启用"
          :description="state.autoAnalyze ? 'AI 只整理灵魂提示词，名称保持不变；创建后立即使用整理结果。' : '名称和灵魂提示词按当前输入保存，创建后立即使用。'"
        />
        <UAlert v-if="errorMessage" color="error" title="创建失败" :description="errorMessage" />
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" :disabled="loading" @click="open = false">取消</UButton>
          <UButton type="submit" :icon="state.autoAnalyze ? 'i-lucide-sparkles' : 'i-lucide-save'" :loading="loading">{{ submitLabel }}</UButton>
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
        <span data-subject-creation-spinner class="subject-processing-spinner relative flex size-14 items-center justify-center">
          <UIcon name="i-lucide-loader-circle" class="size-14 text-primary" />
        </span>
      </div>
      <strong class="text-xl text-highlighted">{{ processingTitle }}</strong>
      <p class="mt-3 max-w-lg text-sm leading-6 text-muted">{{ state.autoAnalyze ? 'AI 整理和结构校验可能需要几十秒' : '正在保存数据' }}，请保持当前页面开启，不要重复提交。</p>
      <p class="mt-1 max-w-lg text-sm leading-6 text-muted">处理完成后会自动进入{{ processingDestination }}继续调整。</p>
    </div>
  </Teleport>
</template>
