import type { H3Event } from 'h3'
import { getMethod, getRequestURL } from 'h3'
import { ApplicationError } from '../application/errors/ApplicationError'
import { readBoundedRequestBody, RequestBodyLimitError } from '../infrastructure/http/BoundedRequestBodyReader'
import { writeErrorResponse } from '../presentation/http/controller'

/** H3 用于复用原始正文的全局 Symbol。 */
const H3_RAW_BODY = Symbol.for('h3RawBody')
/** 允许携带正文的 HTTP 方法。 */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * 在任何 API 控制器解析正文前执行统一的实际字节限制。
 * @param event 当前 H3 请求事件。
 * @returns 正文已安全缓存时无返回值；超限时直接返回稳定错误响应。
 */
async function enforceRequestBodyLimit(event: H3Event) {
  if (!getRequestURL(event).pathname.startsWith('/api/v1/') || !BODY_METHODS.has(getMethod(event))) return
  const configured = Number(useRuntimeConfig(event).limits.requestBodyBytes)
  try {
    const body = await readBoundedRequestBody(event.node.req, configured)
    Reflect.set(event.node.req, H3_RAW_BODY, body)
  }
  catch (error: unknown) {
    if (error instanceof RequestBodyLimitError) {
      return writeErrorResponse(event, new ApplicationError('REQUEST_TOO_LARGE', '请求正文超过系统允许的最大值', 413))
    }
    throw error
  }
}

export default defineEventHandler(enforceRequestBodyLimit)
