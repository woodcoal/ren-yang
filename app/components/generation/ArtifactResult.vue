<script setup lang="ts">
import { computed } from 'vue'
import type { ArtifactOutputFormat } from '#shared/schemas/generation'
import type { RenderedArtifactView } from '#shared/types/generation'

const props = defineProps<{
  /** 运行 UUID，用于构建受认证保护的图片与下载地址。 */
  runId: string
  /** 用户创建运行时选择的最终输出格式。 */
  outputFormat: ArtifactOutputFormat
  /** 服务端按最终结果生成的正文和图片数据。 */
  result: RenderedArtifactView
}>()

/** 文本格式对应的最终正文。 */
const textDocument = computed(() => props.result.documents.txt ?? '')

/**
 * 将 HTML 中的相对图片路径替换为当前运行的受认证图片接口。
 * @returns 仅用于无脚本沙箱 iframe 的完整 HTML。
 */
const previewHtml = computed(() => {
  let html = props.result.documents.html ?? ''
  for (const asset of props.result.assets) {
    const source = `src="${asset.relativePath}"`
    const target = `src="${assetUrl(asset.id)}"`
    html = html.replaceAll(source, target)
  }
  return html
})

/** @param assetId 图片资产 UUID。 @returns 当前运行内的图片读取地址。 */
function assetUrl(assetId: string): string {
  return `/api/v1/runs/${encodeURIComponent(props.runId)}/assets/${encodeURIComponent(assetId)}`
}

/** @returns 当前输出格式对应的下载地址。 */
function exportUrl(): string {
  const format = props.outputFormat === 'html' ? 'html' : 'txt'
  return `/api/v1/runs/${encodeURIComponent(props.runId)}/exports/${format}`
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold text-highlighted">生成结果</h2>
          <p class="mt-1 text-sm text-muted">正文和配图均按本次人物与生成条件生成。</p>
        </div>
        <UButton :to="exportUrl()" external color="neutral" variant="soft" icon="i-lucide-download">下载结果</UButton>
      </div>
    </template>

    <iframe
      v-if="outputFormat === 'html'"
      title="HTML 图文混排结果"
      sandbox=""
      :srcdoc="previewHtml"
      class="h-[42rem] w-full rounded-md border border-default bg-white"
    />

    <div v-else class="space-y-6">
      <pre class="content-pre max-h-[42rem] overflow-auto rounded-md border border-default p-4">{{ textDocument }}</pre>
      <section v-if="result.assets.length" aria-labelledby="generated-images-heading">
        <h3 id="generated-images-heading" class="mb-3 font-medium text-highlighted">配图</h3>
        <div class="grid gap-4 sm:grid-cols-2">
          <figure v-for="asset in result.assets" :key="asset.id" class="overflow-hidden rounded-md border border-default">
            <img :src="assetUrl(asset.id)" :alt="asset.altText" class="h-auto w-full" loading="lazy">
            <figcaption class="p-3 text-sm text-muted">{{ asset.altText }}</figcaption>
          </figure>
        </div>
      </section>
    </div>
  </UCard>
</template>
