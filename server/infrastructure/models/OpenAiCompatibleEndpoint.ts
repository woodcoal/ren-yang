/**
 * 将 OpenAI-compatible API 根地址或完整资源地址归一化为目标资源地址。
 * @param value 配置的 HTTP(S) API 根地址或完整资源地址。
 * @param resourcePath 目标资源相对路径，例如 chat/completions。
 * @returns 有效的完整资源 URL；配置为空、协议不支持或格式错误时返回 null。
 */
export function parseOpenAiCompatibleEndpoint(value: string, resourcePath: string): URL | null {
  if (!value.trim()) return null
  try {
    const endpoint = new URL(value)
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') return null

    const normalizedResourcePath = resourcePath.replace(/^\/+|\/+$/g, '')
    const normalizedPathname = endpoint.pathname.replace(/\/+$/, '')
    if (!normalizedPathname.endsWith(`/${normalizedResourcePath}`)) {
      endpoint.pathname = `${normalizedPathname}/${normalizedResourcePath}`
    }
    return endpoint
  }
  catch {
    return null
  }
}
