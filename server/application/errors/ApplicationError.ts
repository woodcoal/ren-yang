/** 应用层能够稳定映射到 HTTP 响应的预期错误。 */
export class ApplicationError extends Error {
  /**
   * 创建可公开的应用错误。
   * @param code 稳定错误码，供界面判断错误类型。
   * @param message 可向当前管理员展示的中文错误消息。
   * @param statusCode 建议映射的 HTTP 状态码。
   * @param details 不包含敏感信息的可选错误详情。
   */
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApplicationError'
  }
}
