<script setup lang="ts">
import { reactive, shallowRef } from 'vue'
import type { SubmitFeedbackInput } from '#shared/schemas/feedback'
import type { ArtifactBlockView } from '#shared/types/generation'

const props = withDefaults(defineProps<{
  /** 当前运行可定位的正文区域或图片。 */
  blocks?: ArtifactBlockView[]
  /** 父页面提交锁。 */
  loading?: boolean
}>(), { blocks: () => [], loading: false })

const emit = defineEmits<{
  /** 用户提交完整原始反馈。 */
  submit: [input: SubmitFeedbackInput]
}>()

/** 当前反馈表单状态。 */
const form = reactive({
  content: '',
  blockId: '',
  rating: '' as '' | 'positive' | 'negative' | 'neutral',
  isLongTerm: false,
  editedOutput: '',
})
const error = shallowRef<string | null>(null)

/** @returns 校验最少输入并发出不可变反馈提交意图。 */
function submit(): void {
  error.value = null
  if (!form.content.trim()) {
    error.value = '反馈内容不能为空'
    return
  }
  emit('submit', {
    content: form.content.trim(),
    blockId: form.blockId || null,
    rating: form.rating || null,
    isLongTerm: form.isLongTerm,
    editedOutput: form.editedOutput || null,
  })
}

/** @param block 内部结果单元。 @returns 用户可理解的正文区域或图片名称。 */
function resultPartLabel(block: ArtifactBlockView): string {
  const sameTypeIndex = props.blocks.filter(item => item.type === block.type && item.ordinal <= block.ordinal).length
  return block.type === 'image' ? `第 ${sameTypeIndex} 张图片` : `第 ${sameTypeIndex} 段正文`
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <UFormField label="反馈内容" required>
      <UTextarea v-model="form.content" :rows="4" placeholder="说明哪里需要调整，以及这是否应成为长期人物变化。" />
    </UFormField>
    <div class="grid gap-4 md:grid-cols-2">
      <UFormField label="具体内容（可选）">
        <select v-model="form.blockId" class="native-control">
          <option value="">整个运行或人物</option>
          <option v-for="block in props.blocks" :key="block.id" :value="block.id">
            {{ resultPartLabel(block) }}
          </option>
        </select>
      </UFormField>
      <UFormField label="评价方向">
        <select v-model="form.rating" class="native-control">
          <option value="">未指定</option>
          <option value="positive">正向</option>
          <option value="negative">负向</option>
          <option value="neutral">中性</option>
        </select>
      </UFormField>
    </div>
    <UFormField label="直接编辑后的文字（可选）">
      <UTextarea v-model="form.editedOutput" :rows="3" placeholder="如已手工改写，可保存最终文字用于审查。" />
    </UFormField>
    <UCheckbox v-model="form.isLongTerm" label="我明确希望这项反馈形成跨运行的长期人物变化" />
    <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
    <UButton type="submit" :loading="props.loading" icon="i-lucide-message-square-plus">提交并获取分类建议</UButton>
  </form>
</template>
