import { getRequestURL, type H3Event } from 'h3'
import { writeErrorResponse } from '../presentation/http/controller'

/** 不要求已有登录会话的公开 API 路径。 */
const PUBLIC_API_PATHS = new Set([
  '/api/v1/setup/status',
  '/api/v1/setup/admin',
  '/api/v1/auth/login',
  '/api/v1/auth/session',
])

/**
 * 对所有非公开 v1 API 强制执行数据库凭据版本复核。
 * @param event 当前 H3 请求事件。
 * @returns 通过认证时不返回内容；失败时直接返回统一错误响应。
 */
async function enforceApiAuthentication(event: H3Event) {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/v1/') || PUBLIC_API_PATHS.has(path)) {
    return
  }

  try {
    await event.context.applicationServices.authentication.requireAuthenticatedAdministrator()
  }
  catch (error: unknown) {
    return writeErrorResponse(event, error)
  }
}

export default defineEventHandler(enforceApiAuthentication)
