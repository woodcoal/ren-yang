/**
 * 从标准 Authorization Bearer 请求头提取 API Key。
 * @param authorization 原始 Authorization 请求头字符串或缺失值。
 * @returns 单一非空 Bearer 凭据；格式不合法时返回 null。
 * @remarks 不接受查询参数、Basic 凭据或带空白的多段值。
 */
export function parseBearerApiKey(authorization: string | undefined): string | null {
  if (!authorization) return null
  const match = /^Bearer ([^\s]+)$/i.exec(authorization)
  return match?.[1] ?? null
}
