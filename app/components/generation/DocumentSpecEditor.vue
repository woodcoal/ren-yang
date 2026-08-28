<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { documentSpecSchema, type DocumentSpec } from '#shared/schemas/generation'

const props = defineProps<{
  /** 当前待确认规格。 */
  spec: DocumentSpec
  /** 保存或确认是否正在进行。 */
  loading?: boolean
}>()

const emit = defineEmits<{
  /** 请求保存一个新的不可变规格修订。 */
  save: [spec: DocumentSpec]
  /** 请求保存当前内容并确认规格。 */
  confirm: [spec: DocumentSpec]
}>()

const draft = reactive<DocumentSpec>(cloneSpec(props.spec))
const validationError = ref<string | null>(null)

watch(() => props.spec, (value) => {
  Object.assign(draft, cloneSpec(value))
}, { deep: true })

/** @param spec 服务端规格。 @returns 可独立编辑的深复制。 */
function cloneSpec(spec: DocumentSpec): DocumentSpec {
  return {
    title: spec.title,
    summary: spec.summary,
    blocks: spec.blocks.map(block => ({
      ...block,
      acceptanceCriteria: [...block.acceptanceCriteria],
      dependsOn: [...block.dependsOn],
    })),
  }
}

/** @returns 在末尾增加一个具有安全唯一键的正文块。 */
function addBlock(): void {
  const usedKeys = new Set(draft.blocks.map(block => block.key))
  let index = draft.blocks.length + 1
  while (usedKeys.has(`block_${index}`)) index += 1
  draft.blocks.push({
    key: `block_${index}`,
    role: 'paragraph',
    instruction: '',
    acceptanceCriteria: ['内容符合要求'],
    dependsOn: [],
  })
}

/** @param index 待删除块下标。 @returns 删除块并清理其他块对它的依赖。 */
function removeBlock(index: number): void {
  const removed = draft.blocks[index]
  if (!removed) return
  draft.blocks.splice(index, 1)
  for (const block of draft.blocks) {
    block.dependsOn = block.dependsOn.filter(key => key !== removed.key)
  }
}

/** @param index 当前块下标。 @param direction 移动方向。 @returns 在合法范围内交换相邻块。 */
function moveBlock(index: number, direction: -1 | 1): void {
  const target = index + direction
  if (target < 0 || target >= draft.blocks.length) return
  const current = draft.blocks[index]
  const adjacent = draft.blocks[target]
  if (!current || !adjacent) return
  draft.blocks[index] = adjacent
  draft.blocks[target] = current
}

/** @param index 块下标。 @param event 文本域输入事件。 @returns 将非空行保存为验收条件。 */
function updateCriteria(index: number, event: Event): void {
  const block = draft.blocks[index]
  if (!block) return
  block.acceptanceCriteria = (event.target as HTMLTextAreaElement).value
    .split('\n').map(value => value.trim()).filter(Boolean)
}

/** @param index 块下标。 @param event 文本输入事件。 @returns 将逗号分隔内容保存为依赖键。 */
function updateDependencies(index: number, event: Event): void {
  const block = draft.blocks[index]
  if (!block) return
  block.dependsOn = (event.target as HTMLInputElement).value
    .split(',').map(value => value.trim()).filter(Boolean)
}

/** @param action 保存或确认动作。 @returns 校验通过后向父组件提交独立规格。 */
function submit(action: 'save' | 'confirm'): void {
  const parsed = documentSpecSchema.safeParse(draft)
  if (!parsed.success) {
    validationError.value = parsed.error.issues[0]?.message ?? '文档规格无效'
    return
  }
  validationError.value = null
  const spec = cloneSpec(parsed.data)
  if (action === 'save') emit('save', spec)
  else emit('confirm', spec)
}
</script>

<template>
  <div class="space-y-5">
    <UAlert v-if="validationError" color="error" title="规格校验失败" :description="validationError" />
    <div class="grid gap-4 md:grid-cols-2">
      <UFormField label="文档标题" required><UInput v-model="draft.title" class="w-full" /></UFormField>
      <UFormField label="文档摘要" required><UInput v-model="draft.summary" class="w-full" /></UFormField>
    </div>

    <div class="space-y-4">
      <div v-for="(block, index) in draft.blocks" :key="`${block.key}-${index}`" class="rounded-md border border-default p-4">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-medium text-highlighted">块 {{ index + 1 }}</h3>
          <div class="flex gap-1">
            <UButton color="neutral" variant="ghost" size="sm" :disabled="index === 0" aria-label="上移块" @click="moveBlock(index, -1)">上移</UButton>
            <UButton color="neutral" variant="ghost" size="sm" :disabled="index === draft.blocks.length - 1" aria-label="下移块" @click="moveBlock(index, 1)">下移</UButton>
            <UButton color="error" variant="ghost" size="sm" :disabled="draft.blocks.length === 1" aria-label="删除块" @click="removeBlock(index)">删除</UButton>
          </div>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="稳定键" required><UInput v-model="block.key" class="w-full" /></UFormField>
          <UFormField label="角色" required>
            <select v-model="block.role" class="native-control">
              <option value="heading">标题</option><option value="paragraph">正文</option><option value="list">列表</option><option value="quote">引用</option>
            </select>
          </UFormField>
          <UFormField label="生成要求" required class="md:col-span-2"><UTextarea v-model="block.instruction" :rows="3" class="w-full" /></UFormField>
          <UFormField label="验收条件（每行一项）" required><UTextarea :model-value="block.acceptanceCriteria.join('\n')" :rows="3" class="w-full" @input="updateCriteria(index, $event)" /></UFormField>
          <UFormField label="依赖块键（逗号分隔）"><UInput :model-value="block.dependsOn.join(', ')" class="w-full" @input="updateDependencies(index, $event)" /></UFormField>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <UButton color="neutral" variant="soft" icon="i-lucide-plus" @click="addBlock">增加文字块</UButton>
      <UButton color="neutral" variant="soft" :loading="loading" @click="submit('save')">保存新修订</UButton>
      <UButton :loading="loading" @click="submit('confirm')">保存并确认执行</UButton>
    </div>
  </div>
</template>
