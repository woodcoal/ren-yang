<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, watch } from 'vue'
import { createGrowthMaterialSchema } from '#shared/schemas/learning'
import type { EditableGrowthMaterial, GrowthMaterialEditorSubmission } from './growthModels'

const props = defineProps<{
  /** 当前编辑素材；null 表示手工添加新文档。 */
  item: EditableGrowthMaterial | null
  /** 页面级动作是否正在执行。 */
  loading: boolean
  /** 世界或人物的通俗对象名称。 */
  subjectLabel: string
}>()

const emit = defineEmits<{
  /** 提交新增或修改后的完整素材。 */
  save: [input: GrowthMaterialEditorSubmission]
}>()

const open = defineModel<boolean>('open', { default: false })
const form = reactive({ title: '', content: '', importance: 3 })
const modalTitle = computed(() => props.item ? `修改${props.subjectLabel}成长素材` : `添加${props.subjectLabel}成长素材`)

/**
 * 从当前素材恢复表单；新增模式使用空文档和默认 3 分。
 * @returns 编辑表单初始化完成时结束。
 */
function resetForm(): void {
  form.title = props.item?.title ?? ''
  form.content = props.item?.content ?? ''
  form.importance = props.item?.importance ?? 3
}

/**
 * 提交通过共享 Schema 校验的成长素材文档。
 * @param event Nuxt UI 表单事件，包含标题、全文和评分。
 * @returns 保存事件发出且弹窗关闭后结束。
 */
function submitForm(event: FormSubmitEvent<typeof form>): void {
  emit('save', { id: props.item?.id, ...event.data })
  open.value = false
}

watch(open, (isOpen) => {
  if (isOpen) resetForm()
})
watch(() => props.item, () => {
  if (open.value) resetForm()
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="modalTitle"
    description="这份文档只进入成长素材池；保存不会加入普通资料库，也不会直接改变当前成长提示词。"
    :dismissible="!loading"
    :close="!loading"
  >
    <template #body>
      <UForm data-growth-editor-form :schema="createGrowthMaterialSchema" :state="form" class="space-y-4" @submit="submitForm">
        <UFormField name="title" label="素材标题" required>
          <UInput v-model="form.title" class="w-full" maxlength="200" :disabled="loading" />
        </UFormField>
        <UFormField name="content" label="文档正文" required>
          <UTextarea v-model="form.content" class="w-full" :rows="9" autoresize :maxrows="18" maxlength="200000" :disabled="loading" />
        </UFormField>
        <UFormField name="importance" label="提炼评分" description="1–5 分；分数越高，AI 综合提炼时权重越高。" class="max-w-72" required>
          <UInput v-model.number="form.importance" class="w-28" type="number" min="1" max="5" :disabled="loading" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="loading" @click="open = false">取消</UButton>
          <UButton type="submit" :loading="loading">{{ item ? '保存修改' : '添加素材' }}</UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
