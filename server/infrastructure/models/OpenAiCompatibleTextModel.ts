import type { TextModelPort, TextModelRequest, TextModelResponse } from '../../ports/TextModelPort'
import { TextModelError } from '../../ports/TextModelPort'
import type { TextModelSnapshot } from '../../domain/generation/GenerationModels'
import { parseOpenAiCompatibleEndpoint } from './OpenAiCompatibleEndpoint'

/** OpenAI-compatible Chat Completions 适配器配置。 */
export interface OpenAiCompatibleTextModelOptions {
  endpoint: string
  apiKey: string
  model: string
  /** 请求供应商时使用的自定义 User-Agent；省略或空值时不覆盖默认请求头。 */
  userAgent?: string
}

/** 通过原生 fetch 调用 OpenAI-compatible Chat Completions，不引入供应商 SDK。 */
export class OpenAiCompatibleTextModel implements TextModelPort {
  /** 由 API 根地址或完整接口地址归一化后的完整接口 URL。 */
  private readonly endpoint: URL | null

  /**
   * 创建文本模型适配器；空配置表示能力关闭，不在构造时联网。
   * @param options 仓库外环境提供的接口、密钥和模型名称。
   */
  constructor(private readonly options: OpenAiCompatibleTextModelOptions) {
    this.endpoint = parseOpenAiCompatibleEndpoint(options.endpoint, 'chat/completions')
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
   * 调用 Chat Completions，并按请求提取纯文本或 JSON 对象。
   * @param request 分层提示、固定参数、结构名称和响应格式。
   * @returns 提取后的模型结果及供应商用量。
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
      const requestBody: Record<string, unknown> = {
        model: snapshot.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        temperature: request.parameters.temperature,
        max_tokens: request.parameters.maxOutputTokens,
      }
      if (request.responseFormat !== 'text') {
        // 仅结构化任务要求供应商启用 JSON 模式；提示词提炼直接接收正文。
        requestBody.response_format = { type: 'json_object' }
      }
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
          ...(this.options.userAgent?.trim() ? { 'user-agent': this.options.userAgent.trim() } : {}),
        },
        body: JSON.stringify(requestBody),
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
      return parseResponse(payload, request.responseFormat ?? 'json_object')
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

/** @param status HTTP 状态码。 @returns 已脱敏的稳定模型异常。 */
function mapHttpError(status: number): TextModelError {
  if (status === 429) return new TextModelError('PROVIDER_RATE_LIMITED', '文本模型接口触发限流', true)
  if (status >= 500) return new TextModelError('PROVIDER_UNAVAILABLE', '文本模型服务暂时不可用', true)
  return new TextModelError('PROVIDER_UNAVAILABLE', `文本模型拒绝请求（HTTP ${status}）`, false)
}

/**
 * 校验 Chat Completions 外层结构，并按指定格式提取首个响应正文。
 * @param value 供应商返回的未知 JSON。
 * @param responseFormat 业务要求的响应正文格式。
 * @returns 提取后的模型结果和用量。
 */
function parseResponse(value: unknown, responseFormat: 'json_object' | 'text'): TextModelResponse {
  if (typeof value !== 'object' || value === null) {
    throw new TextModelError('MODEL_OUTPUT_INVALID', '文本模型响应结构无效', true)
  }
  const response = value as Record<string, unknown>
  const choices = response.choices
  const first = Array.isArray(choices) ? choices[0] as Record<string, unknown> | undefined : undefined
  const message = first?.message as Record<string, unknown> | undefined
  if (typeof message?.content !== 'string') {
    throw new TextModelError('MODEL_OUTPUT_INVALID', '文本模型没有返回文本内容', true)
  }
  const structuredOutput = responseFormat === 'text' ? message.content : parseStructuredContent(message.content)
  const usage = response.usage as Record<string, unknown> | undefined
  const promptTokenDetails = usage?.prompt_tokens_details as Record<string, unknown> | undefined
  const cachedInputTokens = toOptionalNumber(promptTokenDetails?.cached_tokens)
  return {
    rawOutput: message.content,
    structuredOutput,
    usage: {
      inputTokens: toOptionalNumber(usage?.prompt_tokens),
      outputTokens: toOptionalNumber(usage?.completion_tokens),
      totalTokens: toOptionalNumber(usage?.total_tokens),
      ...(promptTokenDetails ? { cachedInputTokens } : {}),
    },
  }
}

/**
 * 解析兼容供应商返回的结构化文本，并容忍 Markdown JSON 代码围栏及其说明文字。
 * @param content Chat Completions 返回的原始文本内容。
 * @returns 解析后的未知 JSON 值。
 * @throws TextModelError 文本既不是纯 JSON，也不包含可解析的 JSON 代码围栏时抛出。
 */
function parseStructuredContent(content: string): unknown {
  const trimmed = content.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed)
  for (const candidate of [trimmed, fenced?.[1]]) {
    if (candidate === undefined) continue
    try {
      return JSON.parse(candidate.trim())
    }
    catch {
      // 先尝试供应商承诺的纯 JSON，再兼容常见代码围栏；两者都失败后统一抛出安全错误。
    }
  }
  throw new TextModelError('MODEL_OUTPUT_INVALID', '文本模型返回的内容不是有效 JSON', true, content)
}

/** @param value 未知用量字段。 @returns 非负有限数或 null。 */
function toOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
