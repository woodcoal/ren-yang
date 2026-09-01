/** 允许携带正文且必须执行字节上限的 HTTP 方法。 */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * 判断请求是否属于需要限制实际正文字节的 API 写操作。
 * @param path 不含查询串的请求路径。
 * @param method HTTP 请求方法。
 * @returns v1 内部或 v2 公共写请求返回 true，其余返回 false。
 * @remarks 限制基于实际读取字节，不信任可缺失或伪造的 Content-Length。
 */
export function requiresBoundedRequestBody(path: string, method: string): boolean {
  return (path.startsWith('/api/v1/') || path.startsWith('/api/v2/')) && BODY_METHODS.has(method.toUpperCase())
}
