/**
 * 校验浏览器修改型请求是否来自当前站点；无浏览器来源头的本机脚本保持可用。
 * @param origin 浏览器 Origin 请求头。
 * @param fetchSite 浏览器 Sec-Fetch-Site 请求头。
 * @param requestOrigin 当前请求协议与主机形成的源。
 * @returns 已知为同源或非浏览器请求时为 true。
 */
export function isBrowserRequestOriginAllowed(
  origin: string | undefined,
  fetchSite: string | undefined,
  requestOrigin: string,
): boolean {
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false
  if (!origin) return true
  try {
    return new URL(origin).origin === requestOrigin
  }
  catch {
    return false
  }
}
