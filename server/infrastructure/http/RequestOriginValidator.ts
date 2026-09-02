/**
 * 校验浏览器修改型请求是否来自当前站点；无浏览器来源头的本机脚本保持可用。
 * @param origin 浏览器 Origin 请求头。
 * @param fetchSite 浏览器 Sec-Fetch-Site 请求头。
 * @param requestOrigin 当前请求协议与主机形成的源。
 * @param trustedOrigins 反向代理部署时允许的额外浏览器来源。
 * @returns 已知为同源或非浏览器请求时为 true。
 */
export function isBrowserRequestOriginAllowed(
  origin: string | undefined,
  fetchSite: string | undefined,
  requestOrigin: string,
  trustedOrigins: ReadonlySet<string> = new Set(),
): boolean {
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false
  if (!origin) return true
  try {
    const normalizedOrigin = new URL(origin).origin
    return normalizedOrigin === requestOrigin || trustedOrigins.has(normalizedOrigin)
  }
  catch {
    return false
  }
}

/**
 * 解析逗号分隔的受信任浏览器来源环境变量。
 * @param value 环境变量原始值；空值代表不额外放宽来源。
 * @returns 规范化后的精确 Origin 集合。
 * @throws Error 任一值不是不含路径的 HTTP(S) Origin 时抛出。
 */
export function parseTrustedBrowserOrigins(value: unknown): ReadonlySet<string> {
  if (value === undefined || value === null || value === '') return new Set()
  if (typeof value !== 'string') throw new Error('NUXT_TRUSTED_BROWSER_ORIGINS 必须是逗号分隔的 HTTP(S) Origin')
  const origins = new Set<string>()
  for (const candidate of value.split(',').map(item => item.trim()).filter(Boolean)) {
    let parsed: URL
    try {
      parsed = new URL(candidate)
    }
    catch {
      throw new Error('NUXT_TRUSTED_BROWSER_ORIGINS 包含无效 Origin')
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== candidate) {
      throw new Error('NUXT_TRUSTED_BROWSER_ORIGINS 只允许不含路径、查询和片段的 HTTP(S) Origin')
    }
    origins.add(parsed.origin)
  }
  return origins
}
