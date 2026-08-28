<script setup lang="ts">
import { reactive, shallowRef, watch } from 'vue'
import { documentSpecSchema, type DocumentSpec } from '#shared/schemas/generation'

const props = defineProps<{
  /** 当前待确认规格。 */
  spec: DocumentSpec
  /** 保存或确认是否正在进行。 */
  loading?: boolean
  /** 当前运行是否固定启用了图片能力。 */
  allowImages?: boolean
}>()

const emit = defineEmits<{
  /** 请求保存一个新的不可变规格修订。 */
  save: [spec: DocumentSpec]
  /** 请求保存当前内容并确认规格。 */
  confirm: [spec: DocumentSpec]
}>()

const draft = reactive<DocumentSpec>(cloneSpec(props.spec))
const validationError = shallowRef<string | null>(null)

watch(() => props.spec, (value) => {
  Object.assign(draft, cloneSpec(value))
}, { deep: true })

/** @param spec 服务端规格。 @returns 可独立编辑的深复制。 */
function cloneSpec(spec: DocumentSpec): DocumentSpec {
  return {
    title: spec.title,
    summary: spec.summary,
    purpose: spec.purpose,
    constraints: [...spec.constraints],
    requestedFormats: [...spec.requestedFormats],
    blocks: spec.blocks.map(block => ({
      ...block,
      acceptanceCriteria: [...block.acceptanceCriteria],
      dependsOn: [...block.dependsOn],
      ...(block.type === 'image' ? { visualBrief: { ...block.visualBrief } } : {}),
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
    type: 'text',
    role: 'paragraph',
    instruction: '',
    acceptanceCriteria: ['内容符合要求'],
    dependsOn: [],
  })
}

/** @returns 在末尾增加一个具有完整视觉简报的图片块。 */
function addImageBlock(): void {
  const usedKeys = new Set(draft.blocks.map(block => block.key))
  let index = draft.blocks.length + 1
  while (usedKeys.has(`image_${index}`)) index += 1
  draft.blocks.push({
    key: `image_${index}`,
    type: 'image',
    role: 'illustration',
    instruction: '',
    acceptanceCriteria: ['图片准确辅助正文表达'],
    dependsOn: [],
    visualBrief: {
      theme: '', subject: '', composition: '', colorPalette: '', texture: '',
      aspectRatio: '16:9', altText: '', negativePrompt: '',
    },
  })
}

/** @param index 块下标。 @param event 类型选择事件。 @returns 在文字和图片默认结构之间安全切换。 */
function changeBlockType(index: number, event: Event): void {
  const current = draft.blocks[index]
  if (!current) return
  const type = (event.target as HTMLSelectElement).value
  if (type === current.type) return
  const common = {
    key: current.key,
    instruction: current.instruction,
    acceptanceCriteria: [...current.acceptanceCriteria],
    dependsOn: [...current.dependsOn],
  }
  draft.blocks[index] = type === 'image'
    ? {
        ...common, type: 'image', role: 'illustration',
        visualBrief: {
          theme: '', subject: '', composition: '', colorPalette: '', texture: '',
          aspectRatio: '16:9', altText: '', negativePrompt: '',
        },
      }
    : { ...common, type: 'text', role: 'paragraph' }
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

/** @param event 约束文本域输入事件。 @returns 将非空行保存为文档约束。 */
function updateConstraints(event: Event): void {
  draft.constraints = (event.target as HTMLTextAreaElement).value
    .split('\n').map(value => value.trim()).filter(Boolean)
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
      <UFormField label="创作目的"><UTextarea v-model="draft.purpose" :rows="3" class="w-full" /></UFormField>
      <UFormField label="约束（每行一项)"><UTextarea :model-value="draft.constraints.join('\n')" :rows="3" class="w-full" @input="updateConstraints($event)" /></UFormField>
      <UFormField label="导出格式" required class="md:col-span-2">
        <div class="flex flex-wrap gap-5">
          <label v-for="format in ['html', 'markdown', 'txt'] as const" :key="format" class="flex items-center gap-2 text-sm">
            <input v-model="draft.requestedFormats" type="checkbox" :value="format">{{ format === 'markdown' ? 'Markdown' : format.toUpperCase() }}
          </label>
        </div>
      </UFormField>
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
          <UFormField label="块类型" required>
            <select :value="block.type" class="native-control" @change="changeBlockType(index, $event)">
              <option value="text">文字</option><option value="image" :disabled="!allowImages">图片</option>
            </select>
          </UFormField>
          <UFormField label="角色" required>
            <select v-if="block.type === 'text'" v-model="block.role" class="native-control">
              <option value="heading">标题</option><option value="paragraph">正文</option><option value="list">列表</option><option value="quote">引用</option>
            </select>
            <select v-else v-model="block.role" class="native-control">
              <option value="hero_image">主图</option><option value="illustration">插图</option>
            </select>
          </UFormField>
          <UFormField label="生成要求" required><UTextarea v-model="block.instruction" :rows="3" class="w-full" /></UFormField>
          <UFormField label="验收条件（每行一项）" required><UTextarea :model-value="block.acceptanceCriteria.join('\n')" :rows="3" class="w-full" @input="updateCriteria(index, $event)" /></UFormField>
          <UFormField label="依赖块键（逗号分隔）"><UInput :model-value="block.dependsOn.join(', ')" class="w-full" @input="updateDependencies(index, $event)" /></UFormField>
          <template v-if="block.type === 'image'">
            <UFormField label="图片主题" required><UInput v-model="block.visualBrief.theme" class="w-full" /></UFormField>
            <UFormField label="图片主体" required><UInput v-model="block.visualBrief.subject" class="w-full" /></UFormField>
            <UFormField label="构图要求" required><UInput v-model="block.visualBrief.composition" class="w-full" /></UFormField>
            <UFormField label="色彩要求" required><UInput v-model="block.visualBrief.colorPalette" class="w-full" /></UFormField>
            <UFormField label="质感要求" required><UInput v-model="block.visualBrief.texture" class="w-full" /></UFormField>
            <UFormField label="宽高比" required>
              <select v-model="block.visualBrief.aspectRatio" class="native-control">
                <option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="16:9">16:9</option><option value="9:16">9:16</option>
              </select>
            </UFormField>
            <UFormField label="替代文本" required><UInput v-model="block.visualBrief.altText" class="w-full" /></UFormField>
            <UFormField label="排除项"><UInput v-model="block.visualBrief.negativePrompt" class="w-full" /></UFormField>
          </template>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <UButton color="neutral" variant="soft" icon="i-lucide-plus" @click="addBlock">增加文字块</UButton>
      <UButton v-if="allowImages" color="neutral" variant="soft" icon="i-lucide-image-plus" @click="addImageBlock">增加图片块</UButton>
      <UButton color="neutral" variant="soft" :loading="loading" @click="submit('save')">保存新修订</UButton>
      <UButton :loading="loading" @click="submit('confirm')">保存并确认执行</UButton>
    </div>
  </div>
</template>
