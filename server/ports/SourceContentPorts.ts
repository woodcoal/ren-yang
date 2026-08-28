import type { SourceChunkRecord, SourceInputType } from '../domain/content/ContentModels'

/** 经过安全解码和规范化的资料文件。 */
export interface DecodedSourceFile {
  /** 根据扩展名确认的输入类型。 */
  inputType: Exclude<SourceInputType, 'paste'>
  /** 统一换行后的 UTF-8 正文。 */
  content: string
  /** 用于本地保存的安全扩展名。 */
  extension: '.txt' | '.md'
}

/** 资料正文处理端口。 */
export interface SourceContentProcessor {
  /**
   * 规范化粘贴文本并执行安全限制。
   * @param content 用户输入的正文。
   * @returns 规范化正文。
   */
  normalizeText(content: string): string

  /**
   * 严格解码 TXT 或 Markdown 文件。
   * @param fileName 用户上传的原始文件名。
   * @param mediaType 浏览器提供的媒体类型。
   * @param bytes 文件字节。
   * @returns 安全输入类型、正文和扩展名。
   */
  decodeFile(fileName: string, mediaType: string | undefined, bytes: Uint8Array): DecodedSourceFile

  /**
   * 计算规范化正文的 SHA-256。
   * @param content 规范化正文。
   * @returns 小写十六进制哈希。
   */
  hash(content: string): string

  /**
   * 把正文切为可检索且顺序稳定的证据片段。
   * @param sourceId 所属资料标识。
   * @param content 规范化正文。
   * @returns 带稳定序号和哈希的切片。
   */
  chunk(sourceId: string, content: string): SourceChunkRecord[]
}

/** 原始资料文件存储端口。 */
export interface SourceFileStorage {
  /**
   * 保存已验证的原始资料文件。
   * @param sourceId 资料标识。
   * @param extension 安全扩展名。
   * @param bytes 已通过校验的原始字节。
   * @returns 相对数据目录的 POSIX 路径。
   */
  save(sourceId: string, extension: '.txt' | '.md', bytes: Uint8Array): Promise<string>

  /**
   * 删除由本系统保存的资料文件。
   * @param relativePath 数据目录内相对路径。
   * @returns 删除完成时结束；文件不存在也视为成功。
   */
  delete(relativePath: string): Promise<void>
}
