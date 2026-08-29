import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import type { ImageModelPort, ImageModelRequest, ImageModelResponse } from '../../ports/ImageModelPort'
import { ImageModelError } from '../../ports/ImageModelPort'
import type { ImageModelSnapshot } from '../../domain/generation/GenerationModels'
import { parseOpenAiCompatibleEndpoint } from './OpenAiCompatibleEndpoint'

/** OpenAI-compatible Images Generations 适配器配置。 */
export interface OpenAiCompatibleImageModelOptions {
  endpoint: string
  apiKey: string
  model: string
}

/** 单张供应商响应允许下载的最大字节数。 */
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024
/** 图片下载禁止访问的非公网 IPv4 与 IPv6 地址范围。 */
const PRIVATE_NETWORKS = createPrivateNetworkBlockList()

/** 通过原生 fetch 调用 Images Generations，并归一化 Base64 或安全远程图片。 */
export class OpenAiCompatibleImageModel implements ImageModelPort {
  /** 由 API 根地址或完整接口地址归一化后的完整接口 URL。 */
  private readonly endpoint: URL | null

  /** @param options 仓库外提供的接口、密钥和模型。 */
  constructor(private readonly options: OpenAiCompatibleImageModelOptions) {
    this.endpoint = parseOpenAiCompatibleEndpoint(options.endpoint, 'images/generations')
  }

  /** @returns 配置完整时的非敏感图片模型快照，否则返回 null。 */
  getConfiguredModel(): ImageModelSnapshot | null {
    if (!this.endpoint || !this.options.apiKey.trim() || !this.options.model.trim()) return null
    return {
      provider: 'openai_compatible_images',
      model: this.options.model.trim(),
      endpointOrigin: this.endpoint.origin,
    }
  }

  /**
   * 生成图片并解析 Base64；供应商只返回 URL 时执行受限下载。
   * @param request 视觉提示、宽高比和超时。
   * @returns 待本地存储继续校验的图片字节。
   */
  async generate(request: ImageModelRequest): Promise<ImageModelResponse> {
    const snapshot = this.getConfiguredModel()
    if (!snapshot || !this.endpoint) throw new ImageModelError('CAPABILITY_DISABLED', '图片模型尚未配置', false)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({
          model: snapshot.model,
          prompt: request.prompt,
          size: mapAspectRatio(request.aspectRatio),
          response_format: 'b64_json',
          n: 1,
        }),
        signal: controller.signal,
      })
      if (!response.ok) throw mapHttpError(response.status)
      let payload: unknown
      try {
        payload = await response.json()
      }
      catch {
        throw new ImageModelError('IMAGE_OUTPUT_INVALID', '图片模型响应不是有效 JSON', true)
      }
      return await parseImageResponse(payload, controller.signal)
    }
    catch (error: unknown) {
      if (error instanceof ImageModelError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ImageModelError('IMAGE_PROVIDER_TIMEOUT', '图片模型请求超时', true)
      }
      throw new ImageModelError('IMAGE_PROVIDER_UNAVAILABLE', '图片模型网络请求失败', true)
    }
    finally {
      clearTimeout(timeout)
    }
  }
}

/** @param ratio 规格宽高比。 @returns OpenAI-compatible 常见尺寸。 */
function mapAspectRatio(ratio: ImageModelRequest['aspectRatio']): string {
  if (ratio === '1:1') return '1024x1024'
  if (ratio === '3:4' || ratio === '9:16') return '1024x1536'
  return '1536x1024'
}

/** @param status HTTP 状态码。 @returns 已脱敏稳定图片错误。 */
function mapHttpError(status: number): ImageModelError {
  if (status === 429) return new ImageModelError('IMAGE_PROVIDER_RATE_LIMITED', '图片模型接口触发限流', true)
  if (status >= 500) return new ImageModelError('IMAGE_PROVIDER_UNAVAILABLE', '图片模型服务暂时不可用', true)
  return new ImageModelError('IMAGE_PROVIDER_UNAVAILABLE', `图片模型拒绝请求（HTTP ${status}）`, false)
}

/** @param value 未知供应商响应。 @param signal 共用超时信号。 @returns 图片字节。 */
async function parseImageResponse(value: unknown, signal: AbortSignal): Promise<ImageModelResponse> {
  if (typeof value !== 'object' || value === null) throw new ImageModelError('IMAGE_OUTPUT_INVALID', '图片模型响应结构无效', true)
  const data = (value as Record<string, unknown>).data
  const first = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined
  if (typeof first?.b64_json === 'string') {
    if (first.b64_json.length > Math.ceil(MAX_DOWNLOAD_BYTES * 4 / 3) + 16) {
      throw new ImageModelError('IMAGE_OUTPUT_INVALID', '图片模型 Base64 响应超过大小限制', false)
    }
    const bytes = new Uint8Array(Buffer.from(first.b64_json, 'base64'))
    if (bytes.byteLength === 0) throw new ImageModelError('IMAGE_OUTPUT_INVALID', '图片模型返回空图片', true)
    return { bytes, declaredMediaType: null }
  }
  if (typeof first?.url === 'string') return await downloadPublicImage(first.url, signal)
  throw new ImageModelError('IMAGE_OUTPUT_INVALID', '图片模型没有返回 Base64 或图片 URL', true)
}

/** @param initialUrl 供应商返回 URL。 @param signal 共用超时信号。 @returns 安全下载的图片。 */
async function downloadPublicImage(initialUrl: string, signal: AbortSignal): Promise<ImageModelResponse> {
  let current = parseRemoteUrl(initialUrl)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await assertPublicHost(current)
    const response = await fetch(current, { method: 'GET', redirect: 'manual', signal, headers: { accept: 'image/png,image/jpeg,image/webp' } })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirects === 3) throw new ImageModelError('IMAGE_DOWNLOAD_BLOCKED', '图片下载重定向无效或过多', false)
      current = parseRemoteUrl(new URL(location, current).toString())
      continue
    }
    if (!response.ok || !response.body) throw new ImageModelError('IMAGE_PROVIDER_UNAVAILABLE', '远程图片下载失败', true)
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_DOWNLOAD_BYTES) throw new ImageModelError('IMAGE_OUTPUT_INVALID', '远程图片超过 10 MiB', false)
    return {
      bytes: await readLimitedBody(response.body),
      declaredMediaType: response.headers.get('content-type'),
    }
  }
  throw new ImageModelError('IMAGE_DOWNLOAD_BLOCKED', '图片下载重定向无效', false)
}

/** @param body 图片响应流。 @returns 不超过上限的字节。 */
async function readLimitedBody(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const item = await reader.read()
    if (item.done) break
    total += item.value.byteLength
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel()
      throw new ImageModelError('IMAGE_OUTPUT_INVALID', '远程图片超过 10 MiB', false)
    }
    chunks.push(item.value)
  }
  if (total === 0) throw new ImageModelError('IMAGE_OUTPUT_INVALID', '远程图片为空', true)
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

/** @param value 远程地址。 @returns 无凭据 HTTP(S) URL。 */
function parseRemoteUrl(value: string): URL {
  if (value.length > 2_048) throw new ImageModelError('IMAGE_DOWNLOAD_BLOCKED', '图片下载地址过长', false)
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new ImageModelError('IMAGE_DOWNLOAD_BLOCKED', '图片下载地址无效', false)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ImageModelError('IMAGE_DOWNLOAD_BLOCKED', '图片下载地址协议或凭据无效', false)
  }
  return url
}

/** @param url 待下载 URL。 @returns 主机全部解析结果均为公网地址时结束。 */
async function assertPublicHost(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new ImageModelError('IMAGE_DOWNLOAD_BLOCKED', '禁止下载本机或私有网络图片', false)
  const directType = isIP(hostname)
  const addresses = directType ? [hostname] : (await lookup(hostname, { all: true, verbatim: true })).map(item => item.address)
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new ImageModelError('IMAGE_DOWNLOAD_BLOCKED', '禁止下载本机或私有网络图片', false)
  }
}

/** @param address IPv4 或 IPv6 地址。 @returns 是否属于本机、私有、链路本地或未指定范围。 */
function isPrivateAddress(address: string): boolean {
  const version = isIP(address)
  return version === 0 || PRIVATE_NETWORKS.check(address, version === 6 ? 'ipv6' : 'ipv4')
}

/** @returns 覆盖本机、私网、链路本地、文档、基准测试和组播范围的块列表。 */
function createPrivateNetworkBlockList(): BlockList {
  const blockList = new BlockList()
  const ipv4Ranges: Array<[string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ]
  const ipv6Ranges: Array<[string, number]> = [
    ['::', 128], ['::1', 128], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
  ]
  for (const [network, prefix] of ipv4Ranges) blockList.addSubnet(network, prefix, 'ipv4')
  for (const [network, prefix] of ipv6Ranges) blockList.addSubnet(network, prefix, 'ipv6')
  return blockList
}
