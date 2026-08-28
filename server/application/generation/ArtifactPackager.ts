import { createHash } from 'node:crypto'
import { strToU8, zipSync } from 'fflate'
import type { ArtifactFormat } from '../../../shared/schemas/generation'
import type { GenerationRunRecord, ImageAssetRecord } from '../../domain/generation/GenerationModels'

/** 打包时已经从受控存储读取的图片。 */
export interface ExportImageFile {
  asset: ImageAssetRecord
  bytes: Uint8Array
}

/** 控制器可直接发送的导出文件。 */
export interface ExportedArtifact {
  fileName: string
  mediaType: string
  bytes: Uint8Array
}

/**
 * 生成单文档或包含清单和资源的 ZIP 包。
 * @param run 固定运行快照。
 * @param title 文档标题，仅用于安全文件名前缀。
 * @param format 唯一目标格式。
 * @param document 已由安全渲染器生成的文档。
 * @param images 文档实际引用的受控图片。
 * @param exportedAt UTC Unix 毫秒。
 * @returns 可下载文件。
 */
export function packageArtifact(
  run: GenerationRunRecord,
  title: string,
  format: ArtifactFormat,
  document: string,
  images: ExportImageFile[],
  exportedAt: number,
): ExportedArtifact {
  const extension = format === 'markdown' ? 'md' : format
  const documentName = `document.${extension}`
  const documentBytes = strToU8(document)
  const prefix = `${safeFilePrefix(title)}-${run.id.slice(0, 8)}`
  if (images.length === 0) {
    return { fileName: `${prefix}.${extension}`, mediaType: documentMediaType(format), bytes: documentBytes }
  }

  const files: Record<string, Uint8Array> = { [documentName]: documentBytes }
  for (const image of images) files[image.asset.relativePath] = image.bytes
  const manifestFiles = Object.entries(files).map(([relativePath, bytes]) => ({
    relativePath,
    mediaType: relativePath === documentName ? documentMediaType(format) : images.find(item => item.asset.relativePath === relativePath)?.asset.mediaType,
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }))
  files['manifest.json'] = strToU8(JSON.stringify({
    runId: run.id,
    personaVersionId: run.personaVersionId,
    exportedAt,
    format,
    files: manifestFiles,
  }, null, 2))
  return { fileName: `${prefix}.zip`, mediaType: 'application/zip', bytes: zipSync(files, { level: 0 }) }
}

/** @param title 用户文档标题。 @returns 无路径、控制字符和保留名的短前缀。 */
function safeFilePrefix(title: string): string {
  const normalized = title.normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001F\u007F]/gu, '-')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^[.\s-]+|[.\s-]+$/gu, '')
    .slice(0, 60)
  if (!normalized || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(normalized)) return 'document'
  return normalized
}

/** @param format 导出格式。 @returns 标准文档媒体类型。 */
function documentMediaType(format: ArtifactFormat): string {
  if (format === 'html') return 'text/html; charset=utf-8'
  if (format === 'markdown') return 'text/markdown; charset=utf-8'
  return 'text/plain; charset=utf-8'
}
