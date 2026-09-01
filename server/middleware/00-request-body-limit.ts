import type { H3Event } from 'h3'
import { getMethod, getRequestURL } from 'h3'
import { ApplicationError } from '../application/errors/ApplicationError'
import { readBoundedRequestBody, RequestBodyLimitError } from '../infrastructure/http/BoundedRequestBodyReader'
import { requiresBoundedRequestBody } from '../infrastructure/http/RequestBodyLimitPolicy'
import { writeErrorResponse } from '../presentation/http/controller'
import { writePublicErrorResponse } from '../presentation/http/publicController'

/** H3 用于复用原始正文的全局 Symbol。 */
const H3_RAW_BODY = Symbol.for('h3RawBody')

/**
 * 在任何 API 控制器解析正文前执行统一的实际字节限制。
 * @param event 当前 H3 请求事件。
 * @returns 正文已安全缓存时无返回值；超限时直接返回稳定错误响应。
 */
async function enforceRequestBodyLimit(event: H3Event) {
  const path = getRequestURL(event).pathname
  if (!requiresBoundedRequestBody(path, getMethod(event))) return
  const configured = Number(useRuntimeConfig(event).limits.requestBodyBytes)
  try {
    const body = await readBoundedRequestBody(event.node.req, configured)
    Reflect.set(event.node.req, H3_RAW_BODY, body)
  }
  catch (error: unknown) {
    if (error instanceof RequestBodyLimitError) {
      const mapped = new ApplicationError('REQUEST_TOO_LARGE', '请求正文超过系统允许的最大值', 413)
      return path.startsWith('/api/v2/')
        ? writePublicErrorResponse(event, mapped)
        : writeErrorResponse(event, mapped)
    }
    throw error
  }
}

export default defineEventHandler(enforceRequestBodyLimit)
