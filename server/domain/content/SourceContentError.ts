/** 可安全映射为用户输入错误的资料处理异常。 */
export class SourceContentError extends Error {
  /**
   * 创建资料处理异常。
   * @param message 可直接展示给用户的中文原因。
   */
  constructor(message: string) {
    super(message)
    this.name = 'SourceContentError'
  }
}
