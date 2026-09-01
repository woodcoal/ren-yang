import { getHeader, getRequestURL, type H3Event } from 'h3'
import { ApplicationError } from '../application/errors/ApplicationError'
import { parseBearerApiKey } from '../infrastructure/authentication/ApiKeyBearerAuthentication'
import { writePublicErrorResponse } from '../presentation/http/publicController'

/** 不需要 API Key 的 v2 契约与交互文档路径。 */
const PUBLIC_DOCUMENT_PATHS = new Set(['/api/v2/openapi.json', '/api/v2/docs', '/api/v2/docs/'])

/**
 * 对公共 v2 业务接口强制执行 API Key 认证。
 * @param event 当前 H3 请求事件。
 * @returns 认证成功时附加主体；失败时直接返回统一错误。
 */
async function enforcePublicApiAuthentication(event: H3Event) {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/v2/') || PUBLIC_DOCUMENT_PATHS.has(path)) return
  try {
    const secret = parseBearerApiKey(getHeader(event, 'authorization'))
    if (!secret) throw new ApplicationError('API_KEY_INVALID', 'API Key 无效、已过期或已吊销', 401)
    event.context.apiKeyPrincipal = await event.context.applicationServices.apiKeys.authenticate(secret)
  }
  catch (error: unknown) {
    return writePublicErrorResponse(event, error)
  }
}

export default defineEventHandler(enforcePublicApiAuthentication)
