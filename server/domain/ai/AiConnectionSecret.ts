/**
 * 生成 AI 连接密文使用的稳定附加认证上下文。
 * @param connectionId AI 连接 UUID。
 * @returns 与既有密文兼容的上下文字符串。
 */
export function connectionSecretContext(connectionId: string): string {
  return `ai_connection:${connectionId}`
}
