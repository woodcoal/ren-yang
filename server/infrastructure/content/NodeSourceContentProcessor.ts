import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import type { SourceChunkRecord } from '../../domain/content/ContentModels'
import { SourceContentError } from '../../domain/content/SourceContentError'
import type { IdentifierGenerator } from '../../ports/IdentifierGenerator'
import type { DecodedSourceFile, SourceContentProcessor } from '../../ports/SourceContentPorts'

/** 单份资料允许的最大字节数。 */
const MAX_SOURCE_BYTES = 2_000_000
/** 单个检索切片的目标字符上限。 */
const MAX_CHUNK_CHARACTERS = 1_200

/** 负责资料安全解码、规范化、哈希和确定性切片。 */
export class NodeSourceContentProcessor implements SourceContentProcessor {
  /**
   * 创建资料处理器。
   * @param identifiers 为每个切片生成 UUID 的端口。
   */
  constructor(private readonly identifiers: IdentifierGenerator) {}

  /**
   * 规范化换行、去除 BOM 和首尾空白，并执行文本限制。
   * @param content 用户提供的文本。
   * @returns 规范化后的非空文本。
   * @throws SourceContentError 文本为空、含 NUL 或超过限制时抛出。
   */
  normalizeText(content: string): string {
    const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
    if (!normalized) {
      throw new SourceContentError('资料正文不能为空')
    }
    if (normalized.includes('\0')) {
      throw new SourceContentError('资料正文包含二进制 NUL 字符')
    }
    if (Buffer.byteLength(normalized, 'utf8') > MAX_SOURCE_BYTES) {
      throw new SourceContentError('资料正文不能超过 2000000 字节')
    }
    return normalized
  }

  /**
   * 按扩展名和媒体类型校验文件，并使用严格 UTF-8 解码。
   * @param fileName 用户上传的文件名，仅用于判断扩展名。
   * @param mediaType 浏览器声明的媒体类型。
   * @param bytes 原始文件字节。
   * @returns 已验证的输入类型、正文与安全扩展名。
   * @throws SourceContentError 类型、大小或编码不合法时抛出。
   */
  decodeFile(fileName: string, mediaType: string | undefined, bytes: Uint8Array): DecodedSourceFile {
    if (bytes.byteLength === 0) {
      throw new SourceContentError('上传文件不能为空')
    }
    if (bytes.byteLength > MAX_SOURCE_BYTES) {
      throw new SourceContentError('上传文件不能超过 2 MB')
    }

    const extension = extname(fileName).toLowerCase()
    const allowedMediaTypes = new Set(['', 'text/plain', 'text/markdown', 'text/x-markdown', 'application/octet-stream'])
    if ((extension !== '.txt' && extension !== '.md' && extension !== '.markdown')
      || !allowedMediaTypes.has((mediaType ?? '').toLowerCase())) {
      throw new SourceContentError('仅支持 UTF-8 编码的 TXT 或 Markdown 文件')
    }

    let decoded: string
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    catch {
      throw new SourceContentError('文件不是有效的 UTF-8 文本')
    }

    const isMarkdown = extension === '.md' || extension === '.markdown'
    return {
      inputType: isMarkdown ? 'markdown' : 'txt',
      content: this.normalizeText(decoded),
      extension: isMarkdown ? '.md' : '.txt',
    }
  }

  /**
   * 计算文本 SHA-256。
   * @param content 规范化文本。
   * @returns 小写十六进制 SHA-256。
   */
  hash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex')
  }

  /**
   * 按 Markdown 标题和段落边界切片，超长段落再按字符上限拆分。
   * @param sourceId 所属资料 UUID。
   * @param content 规范化正文。
   * @returns 从零开始排序且正文非空的切片。
   */
  chunk(sourceId: string, content: string): SourceChunkRecord[] {
    const sections = splitIntoSections(content)
    const chunks: SourceChunkRecord[] = []

    for (const section of sections) {
      for (const part of splitSectionContent(section.content)) {
        chunks.push({
          id: this.identifiers.create(),
          sourceId,
          ordinal: chunks.length,
          heading: section.heading,
          content: part,
          contentHash: this.hash(part),
        })
      }
    }
    return chunks
  }
}

/** 标题及其正文分区。 */
interface SourceSection {
  /** 最近的 Markdown 标题。 */
  heading: string | null
  /** 分区正文。 */
  content: string
}

/**
 * 按 Markdown 标题提取正文分区；纯文本会形成单个无标题分区。
 * @param content 规范化正文。
 * @returns 保持原顺序的非空分区。
 */
function splitIntoSections(content: string): SourceSection[] {
  const sections: SourceSection[] = []
  let heading: string | null = null
  let lines: string[] = []

  /**
   * 保存当前非空正文并清空缓冲区。
   * @returns 无返回值。
   */
  function flush(): void {
    const sectionContent = lines.join('\n').trim()
    if (sectionContent) {
      sections.push({ heading, content: sectionContent })
    }
    lines = []
  }

  for (const line of content.split('\n')) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line)
    if (match) {
      flush()
      heading = match[2]!.trim()
    }
    else {
      lines.push(line)
    }
  }
  flush()
  return sections.length > 0 ? sections : [{ heading, content }]
}

/**
 * 优先按空行组合段落，再对超长内容执行硬切分。
 * @param content 单个标题分区的正文。
 * @returns 每项不超过目标字符数的非空切片正文。
 */
function splitSectionContent(content: string): string[] {
  const output: string[] = []
  let buffer = ''
  for (const paragraph of content.split(/\n{2,}/).map(value => value.trim()).filter(Boolean)) {
    if (paragraph.length > MAX_CHUNK_CHARACTERS) {
      if (buffer) {
        output.push(buffer)
        buffer = ''
      }
      for (let offset = 0; offset < paragraph.length; offset += MAX_CHUNK_CHARACTERS) {
        output.push(paragraph.slice(offset, offset + MAX_CHUNK_CHARACTERS))
      }
      continue
    }

    const combined = buffer ? `${buffer}\n\n${paragraph}` : paragraph
    if (combined.length > MAX_CHUNK_CHARACTERS) {
      output.push(buffer)
      buffer = paragraph
    }
    else {
      buffer = combined
    }
  }
  if (buffer) {
    output.push(buffer)
  }
  return output
}
