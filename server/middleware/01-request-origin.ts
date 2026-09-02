import type { H3Event } from 'h3'
import { getMethod, getRequestHeader, getRequestURL } from 'h3'
import { ApplicationError } from '../application/errors/ApplicationError'
import { isBrowserRequestOriginAllowed, parseTrustedBrowserOrigins } from '../infrastructure/http/RequestOriginValidator'
import { writeErrorResponse } from '../presentation/http/controller'

/** 会改变服务端状态的 HTTP 方法。 */
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * 拒绝浏览器发起的跨站 API 修改请求，补充会话 Cookie 的 SameSite 防护。
 * @param event 当前 H3 请求事件。
 * @returns 同源或非浏览器请求时无返回值；跨站时返回稳定错误。
 */
function enforceRequestOrigin(event: H3Event) {
  const url = getRequestURL(event)
  if (!url.pathname.startsWith('/api/v1/') || !MUTATION_METHODS.has(getMethod(event))) return
  const trustedOrigins = parseTrustedBrowserOrigins(useRuntimeConfig(event).trustedBrowserOrigins)
  const allowed = isBrowserRequestOriginAllowed(
    getRequestHeader(event, 'origin'),
    getRequestHeader(event, 'sec-fetch-site'),
    url.origin,
    trustedOrigins,
  )
  if (!allowed) {
    return writeErrorResponse(event, new ApplicationError('CROSS_SITE_REQUEST_REJECTED', '拒绝跨站修改请求', 403))
  }
}

export default defineEventHandler(enforceRequestOrigin)
