import { createHash } from 'node:crypto'
import type { H3Event, MultiPartData } from 'h3'
import { getRequestHeader, readMultipartFormData } from 'h3'
import { publicImportSourceFileMetadataSchema } from '#shared/schemas/publicApi'
import { ApplicationError } from '../../../application/errors/ApplicationError'
import { executePublicWriteController, writePublicPreflightError } from '../../../presentation/http/publicController'
import { toPublicJson } from '../../../presentation/http/publicJson'

/**
 * 导入单个 TXT 或 Markdown 文件并支持持久幂等。
 * @param event 当前公共请求。
 * @returns 新资料详情响应。
 * @remarks 要求 `library:write` 权限和幂等键；实际请求字节受全局上限约束。
 */
async function handleImportSourceFile(event: H3Event) {
  try {
    const contentLength = Number(getRequestHeader(event, 'content-length') ?? 0)
    if (contentLength > 2_100_000) throw new ApplicationError('VALIDATION_FAILED', '上传请求不能超过 2.1 MB', 422)
    const parts = await readMultipartFormData(event)
    if (!parts) throw new ApplicationError('VALIDATION_FAILED', '请求必须使用 multipart/form-data', 422)
    const metadata = publicImportSourceFileMetadataSchema.parse({
      name: readTextPart(parts, 'name'), role: readTextPart(parts, 'role'), targets: readJsonPart(parts, 'targets'),
    })
    const files = parts.filter(part => part.name === 'file' && part.filename)
    const file = files[0]
    if (files.length !== 1 || !file?.filename) {
      throw new ApplicationError('VALIDATION_FAILED', '必须选择一个 TXT 或 Markdown 文件', 422)
    }
    const payload = {
      ...metadata,
      fileName: file.filename,
      mediaType: file.type ?? null,
      contentHash: createHash('sha256').update(file.data).digest('hex'),
    }
    return await executePublicWriteController(event, 'library:write', {
      payload, targetType: 'source', successStatusCode: 201, targetId: data => readSourceId(data),
    }, async () => {
      const targets = await Promise.all(metadata.targets.map(async target => target.targetType === 'persona'
        ? { ...target, targetId: await event.context.applicationServices.content.resolvePersonaIdentifier(target.targetId) }
        : target))
      return toPublicJson(await event.context.applicationServices.content.importSourceFile({
        ...metadata, targets, fileName: file.filename, mediaType: file.type, bytes: file.data,
      }))
    })
  }
  catch (error: unknown) {
    return await writePublicPreflightError(event, 'source', error)
  }
}

/** @param parts multipart 字段。 @param name 字段名。 @returns UTF-8 文本或 undefined。 */
function readTextPart(parts: MultiPartData[], name: string): string | undefined {
  return parts.find(candidate => candidate.name === name && !candidate.filename)?.data.toString('utf8')
}

/** @param parts multipart 字段。 @param name 字段名。 @returns 交由 Zod 校验的 JSON 值。 */
function readJsonPart(parts: MultiPartData[], name: string): unknown {
  const value = readTextPart(parts, name)
  if (!value) return []
  try {
    return JSON.parse(value)
  }
  catch {
    throw new ApplicationError('VALIDATION_FAILED', `${name} 必须是有效 JSON`, 422)
  }
}

/** @param value 公共资料详情。 @returns 资料 UUID 或 null。 */
function readSourceId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const source = (value as Record<string, unknown>).source
  if (typeof source !== 'object' || source === null) return null
  const id = (source as Record<string, unknown>).id
  return typeof id === 'string' ? id : null
}

export default defineEventHandler(handleImportSourceFile)
