import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalImageAssetStorage } from '../../server/infrastructure/content/LocalImageAssetStorage'
import { LocalSourceFileStorage } from '../../server/infrastructure/content/LocalSourceFileStorage'
import { readBoundedRequestBody, RequestBodyLimitError } from '../../server/infrastructure/http/BoundedRequestBodyReader'
import { NodeStorageCapacityGuard } from '../../server/infrastructure/system/NodeStorageCapacityGuard'
import type { StorageCapacityGuard } from '../../server/ports/StorageCapacity'
import { StorageCapacityError } from '../../server/ports/StorageCapacity'

/** 始终模拟磁盘余量不足的测试门禁。 */
class RejectingCapacityGuard implements StorageCapacityGuard {
  /** @returns 始终拒绝写入。 */
  async assertCanWrite(): Promise<void> {
    throw new StorageCapacityError()
  }
}

let directory: string

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-limits-test-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('请求与磁盘资源限制', () => {
  it('请求声明长度超过上限时不读取正文即拒绝', async () => {
    const request = createRequest([], { 'content-length': '6' })
    await expect(readBoundedRequestBody(request, 5)).rejects.toBeInstanceOf(RequestBodyLimitError)
  })

  it('分块传输实际字节超过上限时拒绝，不能绕过 Content-Length', async () => {
    const request = createRequest([Buffer.from('123'), Buffer.from('456')], {})
    await expect(readBoundedRequestBody(request, 5)).rejects.toBeInstanceOf(RequestBodyLimitError)
  })

  it('上限内请求只缓存一次并保持原始字节', async () => {
    const request = createRequest([Buffer.from('人物'), Buffer.from('资料')], {})
    await expect(readBoundedRequestBody(request, 20)).resolves.toEqual(Buffer.from('人物资料'))
  })

  it('Nitro 内部请求使用 Web 正文流时不调用未实现的 Node 异步迭代器', async () => {
    const request = createNitroInternalRequest(Buffer.from('渲染请求'))
    await expect(readBoundedRequestBody(request, 20)).resolves.toEqual(Buffer.from('渲染请求'))
  })

  it('资料文件在容量门禁拒绝后不产生半成品', async () => {
    const storage = new LocalSourceFileStorage(directory, new RejectingCapacityGuard())
    const sourceId = '00000000-0000-4000-8000-000000000001'

    await expect(storage.save(sourceId, '.txt', Buffer.from('正文'))).rejects.toBeInstanceOf(StorageCapacityError)
    expect(existsSync(resolve(directory, 'sources', `${sourceId}.txt`))).toBe(false)
  })

  it('图片文件在容量门禁拒绝后不产生目标文件或临时文件', async () => {
    const runId = '00000000-0000-4000-8000-000000000001'
    const assetId = '00000000-0000-4000-8000-000000000002'
    const storage = new LocalImageAssetStorage(directory, new RejectingCapacityGuard())

    await expect(storage.saveImage(
      runId,
      assetId,
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]),
      'image/png',
    )).rejects.toBeInstanceOf(StorageCapacityError)
    expect(existsSync(resolve(directory, 'artifacts', runId, 'assets', `${assetId}.png`))).toBe(false)
  })

  it('真实文件系统余量低于保留门槛时稳定拒绝', async () => {
    const guard = new NodeStorageCapacityGuard(Number.MAX_SAFE_INTEGER)
    await expect(guard.assertCanWrite(directory, 1)).rejects.toBeInstanceOf(StorageCapacityError)
  })
})

/**
 * 创建只实现正文流和请求头的测试 Node 请求。
 * @param chunks 按顺序到达的正文块。
 * @param headers 请求头。
 * @returns 可由限制读取器消费的请求流。
 */
function createRequest(chunks: Buffer[], headers: IncomingMessage['headers']): IncomingMessage {
  return Object.assign(Readable.from(chunks), { headers }) as IncomingMessage
}

/**
 * 构造 Nitro 服务端内部 `$fetch` 产生的最小请求形态。
 * @param body 内部 Web 请求正文。
 * @returns Node 异步迭代器不可用、但含 Web 正文流的请求替身。
 */
function createNitroInternalRequest(body: Buffer): IncomingMessage {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body)
      controller.close()
    },
  })
  return {
    headers: { 'content-length': String(body.byteLength) },
    __unenv__: {},
    body: stream,
    async *[Symbol.asyncIterator](): AsyncGenerator<never> {
      throw new Error('Readable.asyncIterator is not implemented yet!')
    },
  } as unknown as IncomingMessage
}
