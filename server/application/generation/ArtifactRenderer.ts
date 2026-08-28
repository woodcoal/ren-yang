import type { ArtifactFormat, DocumentSpec } from '../../../shared/schemas/generation'
import type { ArtifactBlockRecord, ImageAssetRecord } from '../../domain/generation/GenerationModels'

/** 渲染器消费的已选择块事实。 */
export interface SelectedArtifactBlock {
  /** 持久化块及顺序。 */
  block: ArtifactBlockRecord
  /** 文字块的已选纯文本。 */
  outputText: string | null
  /** 图片块的已选本地资产。 */
  asset: ImageAssetRecord | null
}

/**
 * 从同一组选中块生成指定格式，不执行任何模型输出中的标记。
 * @param spec 已确认文档规格。
 * @param blocks 按文档顺序排列的已选择块。
 * @param formats 非空且去重的目标格式。
 * @returns 格式到文档文本的映射。
 */
export function renderArtifact(
  spec: DocumentSpec,
  blocks: SelectedArtifactBlock[],
  formats: ArtifactFormat[],
): Partial<Record<ArtifactFormat, string>> {
  const result: Partial<Record<ArtifactFormat, string>> = {}
  for (const format of formats) {
    if (format === 'html') result.html = renderHtml(spec, blocks)
    else if (format === 'markdown') result.markdown = renderMarkdown(spec, blocks)
    else result.txt = renderText(spec, blocks)
  }
  return result
}

/** @param spec 文档规格。 @param blocks 已选择块。 @returns 可独立打开的安全 HTML。 */
function renderHtml(spec: DocumentSpec, blocks: SelectedArtifactBlock[]): string {
  const body = blocks.map((item) => {
    if (item.block.type === 'image' && item.asset) {
      const alt = escapeHtml(item.asset.altText)
      return `<figure><img src="${escapeHtml(item.asset.relativePath)}" alt="${alt}"><figcaption>${alt}</figcaption></figure>`
    }
    const text = item.outputText ?? ''
    if (item.block.role === 'heading') return `<h2>${escapeHtml(text)}</h2>`
    if (item.block.role === 'quote') return `<blockquote>${escapeHtml(text)}</blockquote>`
    if (item.block.role === 'list') return `<ul>${toListItems(text).map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`
    return `<p>${escapeHtml(text).replaceAll('\n', '<br>')}</p>`
  }).join('\n')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(spec.title)}</title><style>body{max-width:760px;margin:40px auto;padding:0 20px;font:16px/1.7 system-ui,sans-serif;color:#202124}img{display:block;max-width:100%;height:auto}figure{margin:2rem 0}figcaption{margin-top:.5rem;color:#666;font-size:.875rem}blockquote{margin-left:0;padding-left:1rem;border-left:3px solid #aaa;color:#555}</style></head><body><h1>${escapeHtml(spec.title)}</h1><p>${escapeHtml(spec.summary)}</p>${body}</body></html>`
}

/** @param spec 文档规格。 @param blocks 已选择块。 @returns 标准 Markdown。 */
function renderMarkdown(spec: DocumentSpec, blocks: SelectedArtifactBlock[]): string {
  const sections = [`# ${escapeMarkdown(spec.title)}`, escapeMarkdown(spec.summary)]
  for (const item of blocks) {
    if (item.block.type === 'image' && item.asset) {
      sections.push(`![${escapeMarkdownAlt(item.asset.altText)}](${item.asset.relativePath})`)
      continue
    }
    const text = item.outputText ?? ''
    if (item.block.role === 'heading') sections.push(`## ${escapeMarkdown(text)}`)
    else if (item.block.role === 'quote') sections.push(text.split('\n').map(line => `> ${escapeMarkdown(line)}`).join('\n'))
    else if (item.block.role === 'list') sections.push(toListItems(text).map(value => `- ${escapeMarkdown(value)}`).join('\n'))
    else sections.push(escapeMarkdown(text))
  }
  return `${sections.join('\n\n')}\n`
}

/** @param spec 文档规格。 @param blocks 已选择块。 @returns 无控制字符的可读纯文本。 */
function renderText(spec: DocumentSpec, blocks: SelectedArtifactBlock[]): string {
  const sections = [sanitizeText(spec.title), sanitizeText(spec.summary)]
  for (const item of blocks) {
    if (item.block.type === 'image' && item.asset) {
      sections.push(`[图片：${sanitizeText(item.asset.altText)}]\n文件：${item.asset.relativePath}`)
      continue
    }
    const text = sanitizeText(item.outputText ?? '')
    sections.push(item.block.role === 'list' ? toListItems(text).map(value => `- ${value}`).join('\n') : text)
  }
  return `${sections.join('\n\n')}\n`
}

/** @param value 不可信纯文本。 @returns HTML 实体转义文本。 */
function escapeHtml(value: string): string {
  return sanitizeText(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** @param value 不可信纯文本。 @returns 不会创建额外 Markdown 结构的文本。 */
function escapeMarkdown(value: string): string {
  return sanitizeText(value).replace(/([\\`*{}\[\]()#+\-.!_|<>])/g, '\\$1')
}

/** @param value 图片替代文本。 @returns 适用于 Markdown 方括号的文本。 */
function escapeMarkdownAlt(value: string): string {
  return sanitizeText(value).replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
}

/** @param value 可能包含项目符号的文字。 @returns 非空列表项。 */
function toListItems(value: string): string[] {
  const items = value.split('\n').map(line => line.trim().replace(/^[-*•]\s*/u, '')).filter(Boolean)
  return items.length ? items : ['']
}

/** @param value 任意模型文本。 @returns 保留换行和制表符但移除控制字符的文本。 */
function sanitizeText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
}
