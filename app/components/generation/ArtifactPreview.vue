<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { ArtifactFormat } from '#shared/schemas/generation'
import type { RenderedArtifactView } from '#shared/types/generation'

const props = defineProps<{
  /** 运行 UUID，用于下载和图片授权地址。 */
  runId: string
  /** 已确认规格允许的导出格式。 */
  formats: ArtifactFormat[]
  /** 服务端基于同一组选中尝试返回的安全渲染结果。 */
  preview: RenderedArtifactView | null
  /** 预览请求是否正在执行。 */
  loading?: boolean
}>()

defineEmits<{
  /** 请求服务端一次性渲染全部允许格式。 */
  render: []
}>()

/** 当前查看格式。 */
const selectedFormat = shallowRef<ArtifactFormat>(props.formats[0] ?? 'html')

watch(() => props.formats, (formats) => {
  if (!formats.includes(selectedFormat.value)) selectedFormat.value = formats[0] ?? 'html'
}, { deep: true })

/** 当前格式的纯文本文档。 */
const selectedDocument = computed(() => props.preview?.documents[selectedFormat.value] ?? '')

/**
 * 把导出文档中的相对图片路径替换为受登录保护的读取接口，仅用于沙箱预览。
 * @returns 不改变其他 HTML 内容的预览文档。
 */
const previewHtml = computed(() => {
  let html = props.preview?.documents.html ?? ''
  for (const asset of props.preview?.assets ?? []) {
    const source = `src="${asset.relativePath}"`
    const target = `src="/api/v1/runs/${encodeURIComponent(props.runId)}/assets/${encodeURIComponent(asset.id)}"`
    html = html.replaceAll(source, target)
  }
  return html
})

/** @param format 导出格式。 @returns 需要登录授权的下载地址。 */
function exportUrl(format: ArtifactFormat): string {
  return `/api/v1/runs/${encodeURIComponent(props.runId)}/exports/${format}`
}

/** @param format 导出格式。 @returns 管理界面显示名称。 */
function formatLabel(format: ArtifactFormat): string {
  return format === 'markdown' ? 'Markdown' : format.toUpperCase()
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h2 class="font-semibold text-highlighted">安全预览与导出</h2><p class="mt-1 text-sm text-muted">三种格式均来自当前同一组选中尝试。</p></div>
        <UButton v-if="!preview" :loading="loading" @click="$emit('render')">生成安全预览</UButton>
        <UButton v-else color="neutral" variant="soft" :loading="loading" @click="$emit('render')">刷新预览</UButton>
      </div>
    </template>

    <template v-if="preview">
      <div class="mb-4 flex flex-wrap gap-2">
        <UButton
          v-for="format in formats"
          :key="format"
          size="sm"
          :color="selectedFormat === format ? 'primary' : 'neutral'"
          :variant="selectedFormat === format ? 'solid' : 'soft'"
          @click="selectedFormat = format"
        >{{ formatLabel(format) }}</UButton>
      </div>
      <iframe
        v-if="selectedFormat === 'html'"
        title="HTML 沙箱预览"
        sandbox=""
        :srcdoc="previewHtml"
        class="h-[36rem] w-full rounded-md border border-default bg-white"
      />
      <pre v-else class="content-pre max-h-[36rem] overflow-auto rounded-md border border-default p-4">{{ selectedDocument }}</pre>
    </template>

    <template #footer>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="format in formats"
          :key="format"
          :to="exportUrl(format)"
          external
          color="neutral"
          variant="soft"
          icon="i-lucide-download"
        >下载 {{ formatLabel(format) }}</UButton>
      </div>
    </template>
  </UCard>
</template>
