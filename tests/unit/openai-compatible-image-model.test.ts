import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleImageModel } from '../../server/infrastructure/models/OpenAiCompatibleImageModel'

/** 测试用 PNG 文件头及少量负载。 */
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

/** @returns 配置完整的 OpenAI-compatible 图片模型。 */
function createModel(): OpenAiCompatibleImageModel {
  return new OpenAiCompatibleImageModel({
    endpoint: 'https://images.test/v1/images/generations',
    apiKey: 'test-key',
    model: 'fixed-image-model',
  })
}

/** @returns 固定图片生成请求。 */
function createRequest() {
  return { prompt: '学院图书馆', aspectRatio: '16:9' as const, timeoutMs: 5_000 }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenAiCompatibleImageModel', () => {
  it('优先请求并解析 Base64 图片', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from(PNG_BYTES).toString('base64') }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createModel().generate(createRequest())).resolves.toEqual({
      bytes: PNG_BYTES,
      declaredMediaType: null,
    })
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(requestBody).toMatchObject({ model: 'fixed-image-model', size: '1536x1024', response_format: 'b64_json', n: 1 })
  })

  it('供应商仅返回公网 URL 时受限下载图片', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://93.184.216.34/generated.png' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(PNG_BYTES.byteLength) } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createModel().generate(createRequest())).resolves.toEqual({
      bytes: PNG_BYTES,
      declaredMediaType: 'image/png',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'GET', redirect: 'manual' })
  })

  it('拒绝本机 URL 及跳转到私有网络的地址', async () => {
    const directPrivate = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ url: 'http://127.0.0.1/image.png' }] }), { status: 200 }))
    vi.stubGlobal('fetch', directPrivate)
    await expect(createModel().generate(createRequest())).rejects.toMatchObject({ code: 'IMAGE_DOWNLOAD_BLOCKED', retryable: false })
    expect(directPrivate).toHaveBeenCalledTimes(1)

    const redirectedPrivate = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://93.184.216.34/image.png' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://192.168.1.2/image.png' } }))
    vi.stubGlobal('fetch', redirectedPrivate)
    await expect(createModel().generate(createRequest())).rejects.toMatchObject({ code: 'IMAGE_DOWNLOAD_BLOCKED', retryable: false })
    expect(redirectedPrivate).toHaveBeenCalledTimes(2)

    const privateIpv6 = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ url: 'http://[::ffff:127.0.0.1]/image.png' }] }), { status: 200 }))
    vi.stubGlobal('fetch', privateIpv6)
    await expect(createModel().generate(createRequest())).rejects.toMatchObject({ code: 'IMAGE_DOWNLOAD_BLOCKED', retryable: false })
    expect(privateIpv6).toHaveBeenCalledTimes(1)
  })

  it('拒绝声明或实际超过十 MiB 的远程图片', async () => {
    const oversizedLength = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://93.184.216.34/image.png' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(PNG_BYTES, { status: 200, headers: { 'content-length': String(10 * 1024 * 1024 + 1) } }))
    vi.stubGlobal('fetch', oversizedLength)

    await expect(createModel().generate(createRequest())).rejects.toMatchObject({ code: 'IMAGE_OUTPUT_INVALID', retryable: false })
  })

  it('稳定映射限流、服务失败及无效响应', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })))
    await expect(createModel().generate(createRequest())).rejects.toMatchObject({ code: 'IMAGE_PROVIDER_RATE_LIMITED', retryable: true })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    await expect(createModel().generate(createRequest())).rejects.toMatchObject({ code: 'IMAGE_PROVIDER_UNAVAILABLE', retryable: true })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{}] }), { status: 200 })))
    await expect(createModel().generate(createRequest())).rejects.toMatchObject({ code: 'IMAGE_OUTPUT_INVALID', retryable: true })
  })
})
