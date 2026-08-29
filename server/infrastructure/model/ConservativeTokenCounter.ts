import type { TokenCounter, TokenCountResult } from '../../ports/TokenCounter'

/** 在没有模型专用分词器时提供稳定且偏保守的 Token 估算。 */
export class ConservativeTokenCounter implements TokenCounter {
  /**
   * 按 UTF-8 字节数估算 Token，确保中文和英文均不会被明显低估。
   * @param model 模型名称；保守估算不依赖具体模型。
   * @param text 待估算文本。
   * @returns 估算数量和固定计数器标识。
   */
  count(model: string | null, text: string): TokenCountResult {
    const bytes = new TextEncoder().encode(text).length
    return {
      tokens: Math.ceil(bytes / 3),
      mode: 'estimated',
      counter: `utf8-bytes-v1:${model ?? 'unknown'}`,
    }
  }
}
