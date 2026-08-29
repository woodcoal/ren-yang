import type { H3Event, MultiPartData } from 'h3'
import { getRequestHeader, readMultipartFormData, setResponseStatus } from 'h3'
import { importSourceFileMetadataSchema } from '#shared/schemas/content'
import { ApplicationError } from '../../../application/errors/ApplicationError'
import { executeController } from '../../../presentation/http/controller'

/**
 * 导入单个 TXT 或 Markdown 文件。
 * @param event 当前 H3 请求事件。
 * @returns 新资料详情响应。
 */
async function handleImportSourceFile(event: H3Event) {
  return await executeController(event, async () => {
    const contentLength = Number(getRequestHeader(event, 'content-length') ?? 0)
    if (contentLength > 2_100_000) {
      throw new ApplicationError('VALIDATION_FAILED', '上传请求不能超过 2.1 MB', 400)
    }
    const parts = await readMultipartFormData(event)
    if (!parts) {
      throw new ApplicationError('VALIDATION_FAILED', '请求必须使用 multipart/form-data', 400)
    }
    const metadata = importSourceFileMetadataSchema.parse({
      name: readTextPart(parts, 'name'),
      role: readTextPart(parts, 'role'),
      targets: readJsonPart(parts, 'targets'),
    })
    const files = parts.filter(part => part.name === 'file' && part.filename)
    const file = files[0]
    if (files.length !== 1 || !file?.filename) {
      throw new ApplicationError('VALIDATION_FAILED', '必须选择一个 TXT 或 Markdown 文件', 400)
    }
    const created = await event.context.applicationServices.content.importSourceFile({
      ...metadata,
      fileName: file.filename,
      mediaType: file.type,
      bytes: file.data,
    })
    setResponseStatus(event, 201)
    return created
  })
}

/**
 * 读取 multipart 中的单个 UTF-8 文本字段。
 * @param parts 已解析的 multipart 数据。
 * @param name 字段名称。
 * @returns 字段文本；缺失时返回 undefined 交由 Zod 报错。
 */
function readTextPart(parts: MultiPartData[], name: string): string | undefined {
  const part = parts.find(candidate => candidate.name === name && !candidate.filename)
  return part?.data.toString('utf8')
}

/**
 * 读取 multipart 中的 JSON 字段，空值按空数组处理。
 * @param parts 已解析的 multipart 数据。
 * @param name 字段名称。
 * @returns 解析后的未知值，由共享 Schema 完成结构校验。
 */
function readJsonPart(parts: MultiPartData[], name: string): unknown {
  const value = readTextPart(parts, name)
  if (!value) return []
  try {
    return JSON.parse(value)
  }
  catch {
    throw new ApplicationError('VALIDATION_FAILED', `${name} 必须是有效 JSON`, 400)
  }
}

export default defineEventHandler(handleImportSourceFile)
