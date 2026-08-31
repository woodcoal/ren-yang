import type { TextModelPort } from './TextModelPort'

/** 动态创建 OpenAI-compatible 模型适配器所需的非持久化参数。 */
export interface AiTextModelOptions {
  /** API 根地址或 Chat Completions 完整地址。 */
  endpoint: string
  /** 仅在调用期间解密到内存的 API Key。 */
  apiKey: string
  /** 供应商模型标识。 */
  model: string
}

/** 由应用层按数据库配置动态解析文本模型的工厂端口。 */
export interface AiModelFactory {
  /**
   * 创建一次算法步骤使用的文本模型适配器。
   * @param options 已解密但不会持久化或记录的模型参数。
   * @returns 可立即执行的文本模型端口。
   */
  createTextModel(options: AiTextModelOptions): TextModelPort
}
