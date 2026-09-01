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
    <div class="rounded-lg border border-default bg-elevated/40 p-4 text-sm">
      <p class="font-medium text-highlighted">如何使用反馈学习</p>
      <p class="mt-1 leading-6 text-muted">提交后由 AI 建议用途，最终仍由你确认。反馈可以只修正当前图文、记录参数或资料问题，也可以加入人物成长素材池。</p>
      <p class="mt-2 leading-6 text-muted">只有确认“作为人物成长素材”并在人物工作区完成提炼、校准和发布后，才会影响后续新任务；当前结果和人物不会被自动改写。</p>
    </div>

    <UFormField label="反馈内容" description="填写哪里符合或不符合预期，以及希望系统如何调整。这段文字会作为当前结果的修正指令，或在确认后原样成为人物成长素材。" required>
      <UTextarea v-model="form.content" class="w-full" :rows="4" placeholder="例如：第二段太书面，请改成自然的口语表达，并保留原有数据。" />
    </UFormField>
    <div class="grid gap-4 md:grid-cols-2">
      <UFormField label="具体内容（可选）" description="图文生成可定位到某段正文或图片；兴趣判断或整体反馈保持“整个运行或人物”。">
        <select v-model="form.blockId" class="native-control">
          <option value="">整个运行或人物</option>
          <option v-for="block in props.blocks" :key="block.id" :value="block.id">
            {{ resultPartLabel(block) }}
          </option>
        </select>
      </UFormField>
      <UFormField label="评价方向" description="正向表示认可并希望保留，负向表示不满意或需要纠正，中性表示补充说明。当前只作为人工标签保存，不影响 AI 分类或成长评分。">
        <select v-model="form.rating" class="native-control">
          <option value="">未指定</option>
          <option value="positive">正向</option>
          <option value="negative">负向</option>
          <option value="neutral">中性</option>
        </select>
      </UFormField>
    </div>
    <UFormField label="直接编辑后的文字（可选）" description="如果你已经手工写出理想版本，可在这里保存，供分类和后续审查参考。它不会自动替换当前结果，也不会直接成为成长素材。">
      <UTextarea v-model="form.editedOutput" class="w-full" :rows="3" placeholder="例如：粘贴你手工改写后的完整段落；没有改写时留空。" />
    </UFormField>
    <UCheckbox v-model="form.isLongTerm" label="我明确希望这项反馈形成跨运行的长期人物变化" />
    <p class="text-xs leading-5 text-muted">勾选后只会提高 AI 建议“人物成长素材”的可能性，仍需你在下一步人工确认。</p>
    <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
    <UButton type="submit" :loading="props.loading" icon="i-lucide-message-square-plus">提交并获取分类建议</UButton>
  </form>
</template>
