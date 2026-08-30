<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { computed, reactive, watch } from 'vue'
import { updateGrowthSchema } from '#shared/schemas/learning'
import type { EditableGrowthRecord, GrowthEditorSubmission } from './growthModels'

const props = defineProps<{
  /** 当前正在修改的成长。 */
  item: EditableGrowthRecord
  /** 页面级动作是否正在执行。 */
  loading: boolean
  /** 世界或人物的通俗对象名称。 */
  subjectLabel: string
}>()

const emit = defineEmits<{
  /** 提交新增或修改后的成长内容。 */
  save: [input: GrowthEditorSubmission]
}>()

const open = defineModel<boolean>('open', { default: false })
const form = reactive({ content: props.item.content, importance: props.item.importance })
const title = computed(() => `修改${props.subjectLabel}成长`)

/**
 * 使用当前编辑项重置弹窗表单。
 * @returns 表单字段恢复完成后结束，无业务返回值。
 */
function resetForm(): void {
  form.content = props.item.content
  form.importance = props.item.importance
}

/**
 * 提交通过共享 Schema 校验的成长编辑内容。
 * @param event Nuxt UI 表单事件，包含已清理的正文、范围和重要程度。
 * @returns 发出保存事件并关闭弹窗后结束，无业务返回值。
 */
function submitForm(event: FormSubmitEvent<typeof form>): void {
  emit('save', {
    id: props.item.id,
    content: event.data.content,
    importance: event.data.importance,
  })
  open.value = false
}

// 每次打开或切换编辑目标时重新载入快照，避免上次未提交内容串入下一条。
watch(open, (isOpen) => {
  if (isOpen) resetForm()
})
watch(() => props.item, () => {
  if (open.value) resetForm()
})
</script>

<template>
  <UModal v-model:open="open" :title="title" description="保存会建立新修订并恢复为待确认状态，旧修订仍可追溯。" :dismissible="!loading" :close="!loading">
    <template #body>
      <UForm data-growth-editor-form :schema="updateGrowthSchema" :state="form" class="space-y-4" @submit="submitForm">
        <UFormField name="content" label="成长内容" required>
          <UTextarea v-model="form.content" class="w-full" :rows="7" autoresize :maxrows="14" maxlength="20000" :disabled="loading" />
        </UFormField>
        <UFormField name="importance" label="重要程度" description="1–5 分" class="w-32" required>
          <UInput v-model.number="form.importance" class="w-full" type="number" min="1" max="5" :disabled="loading" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="loading" @click="open = false">取消</UButton>
          <UButton type="submit" :loading="loading">保存新修订</UButton>
        </div>
      </UForm>
    </template>
  </UModal>
</template>
