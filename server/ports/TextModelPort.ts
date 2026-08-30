import type { TextModelParameters } from '../../shared/schemas/generation'
import type { TextModelSnapshot, TextModelUsage } from '../domain/generation/GenerationModels'

/** 文本模型结构化调用输入。 */
export interface TextModelRequest {
  /** 最高优先级系统规则和输出约束。 */
  systemPrompt: string
  /** 已分隔人物、场景、证据和任务的用户消息。 */
  userPrompt: string
  /** 本次运行固定参数。 */
  parameters: TextModelParameters
  /** 供供应商和诊断识别的结构名称。 */
  responseSchemaName: string
  /** 供应商响应格式；省略时保持现有 JSON 对象模式。 */
  responseFormat?: 'json_object' | 'text'
}

/** 文本模型结构化调用结果。 */
export interface TextModelResponse {
  /** 从供应商响应提取的纯文本，或解析后的 JSON 未知值。 */
  structuredOutput: unknown
  /** 供应商返回的可选用量。 */
  usage: TextModelUsage
}

/** 与具体供应商隔离的文本模型端口。 */
export interface TextModelPort {
  /**
   * 返回能力是否配置完整及可安全保存的模型快照。
   * @returns 已配置时的模型快照，否则返回 null。
   */
  getConfiguredModel(): TextModelSnapshot | null

  /**
   * 执行一次文本模型调用，并按请求格式返回纯文本或 JSON 对象。
   * @param request 已完成提示分层和参数解析的请求。
   * @returns 提取后的模型结果和用量。
   */
  generateStructured(request: TextModelRequest): Promise<TextModelResponse>
}

/** 可映射为稳定错误码的模型适配器异常。 */
export class TextModelError extends Error {
  /**
   * 创建模型异常。
   * @param code 稳定错误分类。
   * @param message 已脱敏的中文原因。
   * @param retryable 是否适合有限自动重试。
   */
  constructor(
    public readonly code: 'CAPABILITY_DISABLED' | 'PROVIDER_TIMEOUT' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'MODEL_OUTPUT_INVALID',
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'TextModelError'
  }
}
