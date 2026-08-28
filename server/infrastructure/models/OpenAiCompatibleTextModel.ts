import type { TextModelPort, TextModelRequest, TextModelResponse } from '../../ports/TextModelPort'
import { TextModelError } from '../../ports/TextModelPort'
import type { TextModelSnapshot } from '../../domain/generation/GenerationModels'

/** OpenAI-compatible Chat Completions 适配器配置。 */
export interface OpenAiCompatibleTextModelOptions {
  endpoint: string
  apiKey: string
  model: string
}

/** 通过原生 fetch 调用 OpenAI-compatible Chat Completions，不引入供应商 SDK。 */
export class OpenAiCompatibleTextModel implements TextModelPort {
  /** 通过校验的完整接口 URL。 */
  private readonly endpoint: URL | null

  /**
   * 创建文本模型适配器；空配置表示能力关闭，不在构造时联网。
   * @param options 仓库外环境提供的接口、密钥和模型名称。
   */
  constructor(private readonly options: OpenAiCompatibleTextModelOptions) {
    this.endpoint = parseEndpoint(options.endpoint)
  }

  /**
   * 返回非敏感配置快照。
   * @returns 配置完整时返回模型与接口来源，否则返回 null。
   */
  getConfiguredModel(): TextModelSnapshot | null {
    if (!this.endpoint || !this.options.apiKey.trim() || !this.options.model.trim()) return null
    return {
      provider: 'openai_compatible' as const,
      model: this.options.model.trim(),
      endpointOrigin: this.endpoint.origin,
    }
  }

  /**
   * 调用 Chat Completions 并严格提取 JSON 对象。
   * @param request 分层提示、固定参数和结构名称。
   * @returns 解析后的未知结构及供应商用量。
   * @throws TextModelError 能力缺失、超时、限流、网络或输出错误时抛出。
   */
  async generateStructured(request: TextModelRequest): Promise<TextModelResponse> {
    const snapshot = this.getConfiguredModel()
    if (!snapshot || !this.endpoint) {
      throw new TextModelError('CAPABILITY_DISABLED', '文本模型尚未配置', false)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.parameters.timeoutMs)
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: snapshot.model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
          temperature: request.parameters.temperature,
          max_tokens: request.parameters.maxOutputTokens,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw mapHttpError(response.status)
      }
      let payload: unknown
      try {
        payload = await response.json()
      }
      catch {
        throw new TextModelError('MODEL_OUTPUT_INVALID', '文本模型响应不是有效 JSON', true)
      }
      return parseResponse(payload)
    }
    catch (error: unknown) {
      if (error instanceof TextModelError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TextModelError('PROVIDER_TIMEOUT', '文本模型请求超时', true)
      }
      throw new TextModelError('PROVIDER_UNAVAILABLE', '文本模型网络请求失败', true)
    }
    finally {
      clearTimeout(timeout)
    }
  }
}

/** @param value 配置字符串。 @returns 有效 HTTP(S) URL 或 null。 */
function parseEndpoint(value: string): URL | null {
  if (!value.trim()) return null
  try {
    const endpoint = new URL(value)
    return endpoint.protocol === 'http:' || endpoint.protocol === 'https:' ? endpoint : null
  }
  catch {
    return null
  }
}

/** @param status HTTP 状态码。 @returns 已脱敏的稳定模型异常。 */
function mapHttpError(status: number): TextModelError {
  if (status === 429) return new TextModelError('PROVIDER_RATE_LIMITED', '文本模型接口触发限流', true)
  if (status >= 500) return new TextModelError('PROVIDER_UNAVAILABLE', '文本模型服务暂时不可用', true)
  return new TextModelError('PROVIDER_UNAVAILABLE', `文本模型拒绝请求（HTTP ${status}）`, false)
}

/**
 * 校验 Chat Completions 外层结构并解析首个文本 JSON。
 * @param value 供应商返回的未知 JSON。
 * @returns 结构化结果和用量。
 */
function parseResponse(value: unknown): TextModelResponse {
  if (typeof value !== 'object' || value === null) {
    throw new TextModelError('MODEL_OUTPUT_INVALID', '文本模型响应结构无效', true)
  }
  const response = value as Record<string, unknown>
  const choices = response.choices
  const first = Array.isArray(choices) ? choices[0] as Record<string, unknown> | undefined : undefined
  const message = first?.message as Record<string, unknown> | undefined
  if (typeof message?.content !== 'string') {
    throw new TextModelError('MODEL_OUTPUT_INVALID', '文本模型没有返回 JSON 文本', true)
  }
  let structuredOutput: unknown
  try {
    structuredOutput = JSON.parse(message.content)
  }
  catch {
    throw new TextModelError('MODEL_OUTPUT_INVALID', '文本模型返回的内容不是有效 JSON', true)
  }
  const usage = response.usage as Record<string, unknown> | undefined
  return {
    structuredOutput,
    usage: {
      inputTokens: toOptionalNumber(usage?.prompt_tokens),
      outputTokens: toOptionalNumber(usage?.completion_tokens),
      totalTokens: toOptionalNumber(usage?.total_tokens),
    },
  }
}

/** @param value 未知用量字段。 @returns 非负有限数或 null。 */
function toOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
