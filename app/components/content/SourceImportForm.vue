<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive, ref, shallowRef, useTemplateRef } from 'vue'
import { z } from 'zod'
import {
  createSourceSchema,
  importSourceFileMetadataSchema,
  sourceRoleSchema,
  type CreateSourceInput,
  type CreateSourceWithTargetsInput,
  type SourceCreationTarget,
} from '#shared/schemas/content'
import type { PersonaSummary, WorldSummary } from '#shared/types/content'

/** 单个待上传文件及其独立资料名称。 */
export interface SelectedSourceFile {
  /** 浏览器选择的文件。 */
  file: File
  /** 默认取文件名且允许修改的资料名称。 */
  name: string
}

/** 文件导入事件数据。 */
export interface SourceFileSubmission {
  /** 资料角色。 */
  role: 'canon_fact' | 'reference' | 'style_sample'
  /** 共用的人物与世界关联。 */
  targets: SourceCreationTarget[]
  /** 用户一次选择的文件及各自资料名称。 */
  files: SelectedSourceFile[]
}

/** 资料导入表单属性。 */
interface Props {
  /** 任一导入请求是否正在执行。 */
  loading: boolean
  /** 服务端安全错误消息。 */
  errorMessage: string | null
  /** 是否只显示文件上传区域。 */
  fileOnly?: boolean
  /** 是否显示人物和世界关联选择。 */
  showTargetPicker?: boolean
  /** 可选择的人物。 */
  personas?: PersonaSummary[]
  /** 可选择的世界。 */
  worlds?: WorldSummary[]
}

const props = withDefaults(defineProps<Props>(), {
  fileOnly: false,
  showTargetPicker: false,
  personas: () => [],
  worlds: () => [],
})

const emit = defineEmits<{
  /** 提交粘贴文本资料。 */
  paste: [input: CreateSourceWithTargetsInput]
  /** 批量提交 TXT 或 Markdown 文件。 */
  file: [input: SourceFileSubmission]
}>()

const pasteState = reactive<CreateSourceInput>({ name: '', role: 'reference', content: '' })
const fileState = reactive({ role: 'reference' as SourceFileSubmission['role'] })
const fileFormSchema = z.object({ role: sourceRoleSchema })
const sharedTargets = ref<SourceCreationTarget[]>([])
const selectedFiles = ref<SelectedSourceFile[]>([])
const localFileError = shallowRef<string | null>(null)
const draggingFiles = shallowRef(false)
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

/** @param event 已通过 Schema 校验的粘贴文本。 @returns 无返回值。 */
function submitPaste(event: FormSubmitEvent<CreateSourceInput>): void {
  emit('paste', { ...event.data, targets: [...sharedTargets.value] })
}

/**
 * 从允许的文件扩展名中生成默认资料名称。
 * @param fileName 浏览器提供的原始文件名。
 * @returns 去除 TXT 或 Markdown 扩展名后的名称。
 */
function createDefaultSourceName(fileName: string): string {
  return fileName.replace(/\.(?:txt|md|markdown)$/i, '') || fileName
}

/**
 * 保存一次选取或拖入的全部文件，并为每项生成可编辑的默认资料名称。
 * @param files 浏览器文件列表。
 * @returns 无返回值。
 */
function setSelectedFiles(files: Iterable<File>): void {
  selectedFiles.value = Array.from(files).map(file => ({
    file,
    name: createDefaultSourceName(file.name),
  }))
  localFileError.value = null
}

/**
 * 保存用户通过原生文件输入一次选择的全部文件。
 * @param event 文件输入 change 事件。
 * @returns 无返回值。
 */
function selectFiles(event: Event): void {
  const input = event.target as HTMLInputElement
  setSelectedFiles(input.files ?? [])
}

/**
 * 拖入区域获得文件时显示可投放状态。
 * @param event 原生拖拽事件。
 * @returns 无返回值。
 */
function beginFileDrag(event: DragEvent): void {
  event.preventDefault()
  if (!props.loading) draggingFiles.value = true
}

/**
 * 拖拽离开上传区域时清理视觉状态。
 * @param event 原生拖拽事件。
 * @returns 无返回值。
 */
function endFileDrag(event: DragEvent): void {
  event.preventDefault()
  draggingFiles.value = false
}

/**
 * 接收拖入的全部文件；常规文件输入仍是键盘和触屏的等价入口。
 * @param event 原生拖放事件。
 * @returns 无返回值。
 */
function dropFiles(event: DragEvent): void {
  event.preventDefault()
  draggingFiles.value = false
  if (props.loading) return
  setSelectedFiles(event.dataTransfer?.files ?? [])
}

/**
 * 修改指定待上传文件的资料名称。
 * @param index 文件在当前选择列表中的位置。
 * @param name 用户输入的新名称。
 * @returns 无返回值。
 */
function updateFileName(index: number, name: string): void {
  const item = selectedFiles.value[index]
  if (item) item.name = name
  localFileError.value = null
}

/**
 * 校验文件和各自名称后上送整批数据；文件正文由服务端逐个重新校验。
 * @param event 已通过 Schema 校验的文件元数据。
 * @returns 无返回值。
 */
function submitFile(event: FormSubmitEvent<typeof fileState>): void {
  if (selectedFiles.value.length === 0) {
    localFileError.value = '必须至少选择一个 TXT 或 Markdown 文件'
    return
  }
  for (const item of selectedFiles.value) {
    const result = importSourceFileMetadataSchema.safeParse({ name: item.name, role: event.data.role })
    if (!result.success) {
      localFileError.value = `${item.file.name}：${result.error.issues[0]?.message ?? '资料名称无效'}`
      return
    }
  }
  emit('file', {
    role: event.data.role,
    targets: [...sharedTargets.value],
    files: selectedFiles.value.map(item => ({ ...item })),
  })
  localFileError.value = null
  selectedFiles.value = []
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<template>
  <div class="space-y-6">
    <UCard v-if="props.showTargetPicker">
      <ContentSourceTargetPicker v-model="sharedTargets" :personas="props.personas" :worlds="props.worlds" :disabled="loading" />
    </UCard>

    <div class="grid gap-6" :class="{ 'lg:grid-cols-2': !props.fileOnly }">
      <UCard v-if="!props.fileOnly">
        <template #header><div><h2 class="font-semibold text-highlighted">粘贴文本</h2><p class="mt-1 text-sm text-muted">适合短资料或人工整理后的事实。</p></div></template>
        <UForm :schema="createSourceSchema" :state="pasteState" class="space-y-4" @submit="submitPaste">
          <UFormField name="name" label="资料名称" description="文件名或自定义名称，用于在列表中显示。" required><UInput v-model="pasteState.name" class="w-full" :disabled="loading" /></UFormField>
          <UFormField name="role" label="AI 使用方式" description="确定事实参与事实判断；背景参考补充上下文；风格参考只影响表达。" required>
            <USelect v-model="pasteState.role" class="w-full" :items="[{ label: '原作中的确定事实', value: 'canon_fact' }, { label: '背景参考', value: 'reference' }, { label: '写作风格参考', value: 'style_sample' }]" :disabled="loading" />
          </UFormField>
          <UFormField name="content" label="正文" required><UTextarea v-model="pasteState.content" class="w-full" :rows="9" autoresize :disabled="loading" /></UFormField>
          <UButton type="submit" :loading="loading">导入文本</UButton>
        </UForm>
      </UCard>

      <UCard>
        <template #header><div><h2 class="font-semibold text-highlighted">上传文件</h2><p class="mt-1 text-sm text-muted">可多选或拖入 UTF-8 TXT、MD；每个文件最大 2 MB，不解析 HTML。</p></div></template>
        <UForm :schema="fileFormSchema" :state="fileState" class="space-y-4" @submit="submitFile">
          <UFormField name="role" label="AI 使用方式" description="确定事实参与事实判断；背景参考补充上下文；风格参考只影响表达。" required>
            <USelect v-model="fileState.role" class="w-full" :items="[{ label: '原作中的确定事实', value: 'canon_fact' }, { label: '背景参考', value: 'reference' }, { label: '写作风格参考', value: 'style_sample' }]" :disabled="loading" />
          </UFormField>
          <UFormField label="文件" required>
            <div
              data-source-file-drop-zone
              class="source-file-drop-zone"
              :class="{ 'source-file-drop-zone--dragging': draggingFiles }"
              @dragenter="beginFileDrag"
              @dragover="beginFileDrag"
              @dragleave="endFileDrag"
              @drop="dropFiles"
            >
              <span class="source-file-drop-zone-title">将文件拖到这里，或从下方选择</span>
              <span class="source-file-drop-zone-hint">仅支持 .txt、.md；可一次选择多个文件。</span>
              <input ref="fileInput" type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" class="native-control" multiple :disabled="loading" @change="selectFiles">
            </div>
          </UFormField>
          <p class="sr-only" aria-live="polite">{{ selectedFiles.length ? `已选择 ${selectedFiles.length} 个文件` : '尚未选择文件' }}</p>
          <div v-if="selectedFiles.length" class="space-y-3" aria-label="待导入文件">
            <UFormField v-for="(item, index) in selectedFiles" :key="`${item.file.name}:${item.file.lastModified}:${index}`" :label="item.file.name" description="资料名称可单独修改" required>
              <UInput :model-value="item.name" class="w-full" :disabled="loading" @update:model-value="updateFileName(index, String($event))" />
            </UFormField>
          </div>
          <p v-if="localFileError" class="text-sm text-error" role="alert">{{ localFileError }}</p>
          <UButton type="submit" :loading="loading">{{ selectedFiles.length ? `导入 ${selectedFiles.length} 个文件` : '导入文件' }}</UButton>
        </UForm>
      </UCard>
    </div>
    <p v-if="errorMessage" class="text-sm text-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>
