/** Token 计数结果。 */
export interface TokenCountResult {
  /** 计算或保守估算出的 Token 数。 */
  tokens: number
  /** 是否使用模型精确分词器。 */
  mode: 'exact' | 'estimated'
  /** 计数器与模型的稳定说明。 */
  counter: string
}

/** 模型提示词 Token 计数端口。 */
export interface TokenCounter {
  /**
   * 计算指定文本的输入 Token 数。
   * @param model 模型名称；未知时允许使用保守估算。
   * @param text 待计数文本。
   * @returns Token 数、模式和计数器说明。
   */
  count(model: string | null, text: string): TokenCountResult
}
