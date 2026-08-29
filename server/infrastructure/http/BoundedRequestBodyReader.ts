import type { IncomingMessage } from 'node:http'

/** 请求正文超过全局字节上限时抛出的稳定异常。 */
export class RequestBodyLimitError extends Error {
  /** @param maximumBytes 当前允许的最大请求正文字节数。 */
  constructor(public readonly maximumBytes: number) {
    super(`请求正文不能超过 ${maximumBytes} 字节`)
    this.name = 'RequestBodyLimitError'
  }
}

/**
 * 流式读取 Node 请求正文，并同时约束 Content-Length 与分块传输实际字节数。
 * @param request 当前 Node 请求流。
 * @param maximumBytes 允许缓冲的最大正文字节数。
 * @returns 不超过上限的完整正文。
 */
export async function readBoundedRequestBody(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) throw new Error('请求正文上限必须是正安全整数')
  const declared = parseContentLength(request.headers['content-length'])
  if (declared !== null && declared > maximumBytes) throw new RequestBodyLimitError(maximumBytes)

  const chunks: Buffer[] = []
  let total = 0
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
    total += chunk.byteLength
    if (total > maximumBytes) throw new RequestBodyLimitError(maximumBytes)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, total)
}

/**
 * 解析可信 Node 规范化后的 Content-Length；缺失时返回 null。
 * @param value 请求头原值。
 * @returns 非负安全整数或 null。
 */
function parseContentLength(value: string | undefined): number | null {
  if (value === undefined) return null
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new RequestBodyLimitError(0)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new RequestBodyLimitError(0)
  return parsed
}
