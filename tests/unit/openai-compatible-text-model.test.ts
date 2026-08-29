import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleTextModel } from '../../server/infrastructure/models/OpenAiCompatibleTextModel'
import type { TextModelRequest } from '../../server/ports/TextModelPort'

/** 固定的最小模型请求。 */
const REQUEST: TextModelRequest = {
  systemPrompt: '系统规则',
  userPrompt: '用户任务',
  parameters: {
    temperature: 0.3,
    maxOutputTokens: 256,
    timeoutMs: 1_000,
    maxEvidenceChunks: 4,
    maxTextBlocks: 4,
    maxImageBlocks: 2,
    maxPromptCharacters: 120_000,
    maxTotalTokens: 50_000,
    maxBlockAttempts: 2,
  },
  responseSchemaName: 'test_schema',
}

/** @returns 使用固定安全配置的适配器。 */
function createModel(): OpenAiCompatibleTextModel {
  return new OpenAiCompatibleTextModel({
    endpoint: 'https://model.example/v1/chat/completions',
    apiKey: 'secret-key',
    model: 'test-model',
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('OpenAiCompatibleTextModel', () => {
  it('配置不完整时关闭能力且不发起网络请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const model = new OpenAiCompatibleTextModel({ endpoint: 'file:///tmp/model', apiKey: '', model: '' })

    expect(model.getConfiguredModel()).toBeNull()
    await expect(model.generateStructured(REQUEST)).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED', retryable: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('发送 Chat Completions JSON 请求并解析结构与用量', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"answer":"ok"}' } }],
      usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createModel().generateStructured(REQUEST)).resolves.toEqual({
      structuredOutput: { answer: 'ok' },
      usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12 },
    })
    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'test-model', temperature: 0.3, max_tokens: 256, response_format: { type: 'json_object' } })
    expect(init?.headers).toMatchObject({ authorization: 'Bearer secret-key' })
  })

  it('将限流和无效模型输出映射为可重试稳定错误', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('invalid-response-json', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const model = createModel()

    await expect(model.generateStructured(REQUEST)).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED', retryable: true })
    await expect(model.generateStructured(REQUEST)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', retryable: true })
    await expect(model.generateStructured(REQUEST)).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', retryable: true })
  })

  it('达到请求超时时主动中止并返回可重试错误', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })))
    const operation = createModel().generateStructured(REQUEST)
    const assertion = expect(operation).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', retryable: true })

    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
  })
})
