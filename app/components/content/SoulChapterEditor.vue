<script setup lang="ts">
import type { SoulChapter, SoulSnapshot } from '#shared/types/content'

/** 自由章节编辑器属性。 */
interface Props {
  /** 当前完整灵魂快照。 */
  modelValue: SoulSnapshot
  /** 是否禁止编辑。 */
  disabled?: boolean
  /** 世界或人物，用于展示通俗示例。 */
  subjectType: 'world' | 'persona'
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 章节或运行摘要变化后上送新的完整快照。 */
  'update:modelValue': [value: SoulSnapshot]
}>()

/** 运行摘要的保守 Token 估算，仅用于编辑时提示。 */
const estimatedTokens = computed(() => Math.ceil(new TextEncoder().encode(props.modelValue.runtimeSummary).length / 3))

/**
 * 更新单个章节字段并保持属性不可变。
 * @param index 章节数组下标。
 * @param field 可编辑章节字段。
 * @param value 新字段值。
 * @returns 无返回值。
 */
function updateChapter(
  index: number,
  field: 'title' | 'content' | 'required',
  value: string | boolean,
): void {
  const chapters = props.modelValue.chapters.map((chapter, chapterIndex) => chapterIndex === index
    ? { ...chapter, [field]: value }
    : { ...chapter })
  emitSnapshot(chapters, props.modelValue.runtimeSummary)
}

/**
 * 添加一个位于末尾的新章节。
 * @returns 无返回值。
 */
function addChapter(): void {
  const chapters = props.modelValue.chapters.map(chapter => ({ ...chapter }))
  chapters.push({
    id: crypto.randomUUID(),
    title: props.subjectType === 'world' ? '新的世界规则' : '新的人物设定',
    content: '',
    order: chapters.length,
    required: false,
  })
  emitSnapshot(chapters, props.modelValue.runtimeSummary)
}

/**
 * 删除指定章节；至少保留一个章节。
 * @param index 待删除章节下标。
 * @returns 无返回值。
 */
function removeChapter(index: number): void {
  if (props.modelValue.chapters.length <= 1) return
  const chapters = props.modelValue.chapters.filter((_, chapterIndex) => chapterIndex !== index)
  emitSnapshot(chapters, props.modelValue.runtimeSummary)
}

/**
 * 上移或下移一个章节。
 * @param index 待移动章节下标。
 * @param direction 移动方向。
 * @returns 无返回值。
 */
function moveChapter(index: number, direction: -1 | 1): void {
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= props.modelValue.chapters.length) return
  const chapters = props.modelValue.chapters.map(chapter => ({ ...chapter }))
  const current = chapters[index]
  const target = chapters[targetIndex]
  if (!current || !target) return
  chapters[index] = target
  chapters[targetIndex] = current
  emitSnapshot(chapters, props.modelValue.runtimeSummary)
}

/**
 * 更新实际进入任务提示词的运行摘要。
 * @param value 新摘要。
 * @returns 无返回值。
 */
function updateRuntimeSummary(value: string): void {
  emitSnapshot(props.modelValue.chapters.map(chapter => ({ ...chapter })), value)
}

/**
 * 统一重排章节 order 并上送新的快照。
 * @param chapters 新章节数组。
 * @param runtimeSummary 新运行摘要。
 * @returns 无返回值。
 */
function emitSnapshot(chapters: SoulChapter[], runtimeSummary: string): void {
  emit('update:modelValue', {
    chapters: chapters.map((chapter, order) => ({ ...chapter, order })),
    runtimeSummary,
  })
}
</script>

<template>
  <div class="soul-editor">
    <div class="soul-editor__heading">
      <div>
        <h3>完整灵魂章节</h3>
        <p>章节用于管理和追溯。可以自由增加、改名、排序或删除，不要求固定字段。</p>
      </div>
      <UButton color="neutral" variant="soft" icon="i-lucide-plus" :disabled="disabled" @click="addChapter">增加章节</UButton>
    </div>

    <div class="soul-editor__chapters">
      <section v-for="(chapter, index) in modelValue.chapters" :key="chapter.id" class="soul-chapter">
        <div class="soul-chapter__toolbar">
          <span class="soul-chapter__number">{{ String(index + 1).padStart(2, '0') }}</span>
          <div class="soul-chapter__actions">
            <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-up" aria-label="上移章节" :disabled="disabled || index === 0" @click="moveChapter(index, -1)" />
            <UButton color="neutral" variant="ghost" icon="i-lucide-arrow-down" aria-label="下移章节" :disabled="disabled || index === modelValue.chapters.length - 1" @click="moveChapter(index, 1)" />
            <UButton color="error" variant="ghost" icon="i-lucide-trash-2" aria-label="删除章节" :disabled="disabled || modelValue.chapters.length === 1" @click="removeChapter(index)" />
          </div>
        </div>
        <div class="soul-chapter__fields">
          <UFormField :name="`snapshot.chapters.${index}.title`" label="章节标题" required>
            <UInput :model-value="chapter.title" class="w-full" :disabled="disabled" @update:model-value="updateChapter(index, 'title', String($event))" />
          </UFormField>
          <UFormField :name="`snapshot.chapters.${index}.content`" label="章节正文" required>
            <UTextarea :model-value="chapter.content" class="w-full" :rows="5" autoresize :disabled="disabled" @update:model-value="updateChapter(index, 'content', String($event))" />
          </UFormField>
          <UCheckbox :model-value="chapter.required" label="这是核心章节，压缩运行摘要时不能遗漏" :disabled="disabled" @update:model-value="updateChapter(index, 'required', Boolean($event))" />
        </div>
      </section>
    </div>

    <section class="soul-summary">
      <div class="soul-editor__heading">
        <div>
          <h3>任务运行摘要</h3>
          <p>只有这里会进入新任务提示词；完整章节不会在运行时被随机截断。</p>
        </div>
        <UBadge color="neutral" variant="subtle">预计 {{ estimatedTokens }} Token</UBadge>
      </div>
      <UFormField name="snapshot.runtimeSummary" label="运行摘要" required>
        <UTextarea :model-value="modelValue.runtimeSummary" class="w-full" :rows="7" autoresize :disabled="disabled" @update:model-value="updateRuntimeSummary(String($event))" />
      </UFormField>
    </section>
  </div>
</template>
