import type { H3Event } from 'h3'
import { getRequestHeader, getRouterParam, readMultipartFormData } from 'h3'
import { resourceIdSchema } from '#shared/schemas/content'
import { ApplicationError } from '../../../../application/errors/ApplicationError'
import { executeController } from '../../../../presentation/http/controller'

/** 含 multipart 包装开销的头像上传请求上限。 */
const MAX_AVATAR_REQUEST_BYTES = 2_100_000

/**
 * 上传并替换人物头像。
 * @param event 当前 H3 请求事件。
 * @returns 更新头像后的人物摘要。
 */
async function handleUploadPersonaAvatar(event: H3Event) {
  return await executeController(event, async () => {
    const personaId = resourceIdSchema.parse(getRouterParam(event, 'personaId'))
    const contentLength = Number(getRequestHeader(event, 'content-length') ?? 0)
    if (contentLength > MAX_AVATAR_REQUEST_BYTES) {
      throw new ApplicationError('AVATAR_TOO_LARGE', '头像上传请求不能超过 2.1 MB', 413)
    }
    const parts = await readMultipartFormData(event)
    if (!parts) throw new ApplicationError('VALIDATION_FAILED', '头像必须使用 multipart/form-data 上传', 400)
    const files = parts.filter(part => part.name === 'file' && part.filename)
    const file = files[0]
    if (files.length !== 1 || !file) {
      throw new ApplicationError('VALIDATION_FAILED', '必须选择一张头像图片', 400)
    }
    return await event.context.applicationServices.content.uploadPersonaAvatar(
      personaId,
      file.data,
      file.type ?? null,
    )
  })
}

export default defineEventHandler(handleUploadPersonaAvatar)
