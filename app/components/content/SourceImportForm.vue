<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { reactive, shallowRef } from 'vue'
import {
  createSourceSchema,
  importSourceFileMetadataSchema,
  type CreateSourceInput,
} from '#shared/schemas/content'

/** 文件导入事件数据。 */
export interface SourceFileSubmission {
  /** 资料名称。 */
  name: string
  /** 资料角色。 */
  role: 'canon_fact' | 'reference' | 'style_sample'
  /** 用户选择的单个文件。 */
  file: File
}

/** 资料导入表单属性。 */
interface Props {
  /** 任一导入请求是否正在执行。 */
  loading: boolean
  /** 服务端安全错误消息。 */
  errorMessage: string | null
}

defineProps<Props>()

const emit = defineEmits<{
  /** 提交粘贴文本资料。 */
  paste: [input: CreateSourceInput]
  /** 提交 TXT 或 Markdown 文件。 */
  file: [input: SourceFileSubmission]
}>()

const pasteState = reactive<CreateSourceInput>({ name: '', role: 'reference', content: '' })
const fileState = reactive({ name: '', role: 'reference' as SourceFileSubmission['role'] })
const selectedFile = shallowRef<File | null>(null)
const localFileError = shallowRef<string | null>(null)

/** @param event 已通过 Schema 校验的粘贴文本。 @returns 无返回值。 */
function submitPaste(event: FormSubmitEvent<CreateSourceInput>): void {
  emit('paste', event.data)
}

/**
 * 保存用户通过原生文件输入选择的单个文件。
 * @param event 文件输入 change 事件。
 * @returns 无返回值。
 */
function selectFile(event: Event): void {
  const input = event.target as HTMLInputElement
  selectedFile.value = input.files?.[0] ?? null
  localFileError.value = null
}

/**
 * 校验文件存在后上送元数据和 File；文件正文由服务端重新校验。
 * @param event 已通过 Schema 校验的文件元数据。
 * @returns 无返回值。
 */
function submitFile(event: FormSubmitEvent<typeof fileState>): void {
  if (!selectedFile.value) {
    localFileError.value = '必须选择一个 TXT 或 Markdown 文件'
    return
  }
  emit('file', { ...event.data, file: selectedFile.value })
}
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-2">
    <UCard>
      <template #header><div><h2 class="font-semibold text-highlighted">粘贴文本</h2><p class="mt-1 text-sm text-muted">适合短资料或人工整理后的事实。</p></div></template>
      <UForm :schema="createSourceSchema" :state="pasteState" class="space-y-4" @submit="submitPaste">
        <UFormField name="name" label="资料名称" required><UInput v-model="pasteState.name" class="w-full" :disabled="loading" /></UFormField>
        <UFormField name="role" label="资料角色" required>
          <USelect v-model="pasteState.role" class="w-full" :items="[{ label: '原著事实', value: 'canon_fact' }, { label: '普通参考', value: 'reference' }, { label: '表达样例', value: 'style_sample' }]" :disabled="loading" />
        </UFormField>
        <UFormField name="content" label="正文" required><UTextarea v-model="pasteState.content" class="w-full" :rows="9" autoresize :disabled="loading" /></UFormField>
        <UButton type="submit" :loading="loading">导入粘贴文本</UButton>
      </UForm>
    </UCard>

    <UCard>
      <template #header><div><h2 class="font-semibold text-highlighted">上传文件</h2><p class="mt-1 text-sm text-muted">仅 UTF-8 TXT、MD，最大 2 MB；不解析 HTML。</p></div></template>
      <UForm :schema="importSourceFileMetadataSchema" :state="fileState" class="space-y-4" @submit="submitFile">
        <UFormField name="name" label="资料名称" required><UInput v-model="fileState.name" class="w-full" :disabled="loading" /></UFormField>
        <UFormField name="role" label="资料角色" required>
          <USelect v-model="fileState.role" class="w-full" :items="[{ label: '原著事实', value: 'canon_fact' }, { label: '普通参考', value: 'reference' }, { label: '表达样例', value: 'style_sample' }]" :disabled="loading" />
        </UFormField>
        <UFormField label="文件" required>
          <input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" class="native-control" :disabled="loading" @change="selectFile">
        </UFormField>
        <p v-if="localFileError" class="text-sm text-error" role="alert">{{ localFileError }}</p>
        <UButton type="submit" :loading="loading">导入文件</UButton>
      </UForm>
    </UCard>
    <p v-if="errorMessage" class="text-sm text-error lg:col-span-2" role="alert">{{ errorMessage }}</p>
  </div>
</template>
