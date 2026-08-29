import { describe, expect, it, vi } from 'vitest'
import { OpenVikingHttpContextProvider } from '../../server/infrastructure/context/OpenVikingHttpContextProvider'
import { SwitchableContextProvider } from '../../server/infrastructure/context/SwitchableContextProvider'
import type { ContextIndexRepository, ContextSourceScope } from '../../server/ports/ContextIndexRepository'
import { ContextProviderError, type ContextProvider, type EvidenceCandidate } from '../../server/ports/ContextProvider'
import type { ContextSyncRecordView } from '../../shared/types/context'

/** OpenViking 适配器测试使用的 SQLite 目录替身。 */
class FixedContextIndexRepository implements ContextIndexRepository {
  /** 可变同步记录。 */
  public records: ContextSyncRecordView[] = []

  /** @param scopes 允许检索的固定资料范围。 */
  constructor(private readonly scopes: ContextSourceScope[]) {}

  /** @returns 当前测试不需要完整资料列表。 */
  async listSourceDocuments() { return [] }

  /** @returns 当前测试不需要单项完整资料。 */
  async findSourceDocument() { return null }

  /** @returns 固定人物资料范围。 */
  async listSourceScopes() { return this.scopes }

  /** @returns 同步记录副本。 */
  async listSyncRecords() { return [...this.records] }

  /** @param record 新同步记录。 @returns 无返回值。 */
  async saveSyncRecord(record: ContextSyncRecordView) { this.records = [record] }
}

/** 单一固定证据的上下文提供器替身。 */
class FixedContextProvider implements ContextProvider {
  /** @param provider 提供器标识。 @param evidence 固定证据。 @param openVikingEnabled OpenViking 能力开关。 */
  constructor(
    private readonly provider: 'sqlite_fts5' | 'openviking',
    private readonly evidence: EvidenceCandidate[],
    private readonly openVikingEnabled = provider === 'openviking',
  ) {}

  /** @returns 固定提供器。 */
  getProvider() { return this.provider }

  /** @returns 与固定提供器对应的能力。 */
  getOpenVikingCapability() {
    return { configured: true, enabled: this.openVikingEnabled, provider: 'openviking' as const, endpointOrigin: 'https://ov.test' }
  }

  /** @returns 固定统一证据。 */
  async search() { return this.evidence }
}

/** 测试固定资料 UUID。 */
const SOURCE_ID = '00000000-0000-4000-8000-000000000001'

describe('OpenViking 原生 HTTP 上下文适配器', () => {
  it('按 temp_upload、wait=true 资源写入和限定 URI 检索契约转换统一证据', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.7.7' })),
      new Response(JSON.stringify({ status: 'error', error: { code: 'NOT_FOUND', message: 'not found' } }), { status: 404 }),
      new Response(JSON.stringify({ status: 'ok', result: { temp_file_id: 'temp-1' } })),
      new Response(JSON.stringify({ status: 'ok', result: { status: 'success', root_uri: `viking://resources/ren-yang/${SOURCE_ID}.md` } })),
      new Response(JSON.stringify({
        status: 'ok',
        result: {
          resources: [{
            uri: `viking://resources/ren-yang/${SOURCE_ID}.md/chunk-1`,
            score: 0.91,
            abstract: '摘要',
            content: '这是 OpenViking 返回的证据正文。',
          }],
          memories: [], skills: [], total: 1,
        },
      })),
    ]
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} })
      return responses.shift()!
    }) as unknown as typeof fetch
    const repository = new FixedContextIndexRepository([{ sourceId: SOURCE_ID, role: 'canon_fact', priority: 10 }])
    const provider = new OpenVikingHttpContextProvider({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'secret', timeoutMs: 5_000, repository, fetcher,
    })

    await expect(provider.checkHealth()).resolves.toEqual({ healthy: true, version: '0.7.7' })
    await expect(provider.synchronizeSource({
      id: SOURCE_ID, name: '原著资料', role: 'canon_fact', contentHash: 'a'.repeat(64), contentText: '原著资料正文。',
    })).resolves.toBe(`viking://resources/ren-yang/${SOURCE_ID}.md`)
    await expect(provider.search({ personaId: 'persona', worldId: null, query: '证据', limit: 5 })).resolves.toEqual([
      {
        sourceId: SOURCE_ID,
        chunkId: null,
        role: 'canon_fact',
        heading: null,
        content: '这是 OpenViking 返回的证据正文。',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        priority: 10,
      },
    ])

    expect(requests.map(item => new URL(item.url).pathname)).toEqual([
      '/health', '/api/v1/fs', '/api/v1/resources/temp_upload', '/api/v1/resources', '/api/v1/search/find',
    ])
    expect(new Headers(requests[2]!.init.headers).get('x-api-key')).toBe('secret')
    expect(requests[2]!.init.body).toBeInstanceOf(FormData)
    expect(JSON.parse(String(requests[3]!.init.body))).toMatchObject({
      temp_file_id: 'temp-1',
      to: `viking://resources/ren-yang/${SOURCE_ID}.md`,
      wait: true,
      strict: true,
      tags: [`source_id=${SOURCE_ID}`, 'source_role=canon_fact'],
    })
    expect(JSON.parse(String(requests[4]!.init.body))).toEqual({
      query: '证据',
      target_uri: [`viking://resources/ren-yang/${SOURCE_ID}.md`],
      context_type: 'resource',
      limit: 5,
      read_content: true,
    })
  })

  it('启用后远端失败会明确报错，不在同一检索中调用 SQLite', async () => {
    const localSearch = vi.fn(async () => [])
    const local = {
      getProvider: () => 'sqlite_fts5' as const,
      getOpenVikingCapability: () => ({ configured: false, enabled: false, provider: 'openviking' as const, endpointOrigin: null }),
      search: localSearch,
    }
    const repository = new FixedContextIndexRepository([{ sourceId: SOURCE_ID, role: 'reference', priority: 100 }])
    const remote = new OpenVikingHttpContextProvider({
      enabled: true,
      endpoint: 'https://ov.test',
      apiKey: '',
      timeoutMs: 5_000,
      repository,
      fetcher: vi.fn(async () => new Response(JSON.stringify({ status: 'error' }), { status: 503 })) as unknown as typeof fetch,
    })
    const provider = new SwitchableContextProvider(local, remote, true)

    await expect(provider.search({ personaId: 'persona', worldId: null, query: '问题', limit: 5 }))
      .rejects.toBeInstanceOf(ContextProviderError)
    expect(localSearch).not.toHaveBeenCalled()
  })

  it('关闭时仅走 SQLite，并仍公开 OpenViking 的配置状态', async () => {
    const evidence: EvidenceCandidate[] = [{
      sourceId: SOURCE_ID, chunkId: 'chunk', role: 'reference', heading: null,
      content: '本地证据', contentHash: 'b'.repeat(64), priority: 100,
    }]
    const local = new FixedContextProvider('sqlite_fts5', evidence)
    const remote = new FixedContextProvider('openviking', [], false)
    const provider = new SwitchableContextProvider(local, remote, false)

    expect(provider.getProvider()).toBe('sqlite_fts5')
    expect(provider.getOpenVikingCapability()).toMatchObject({ configured: true, enabled: false })
    await expect(provider.search({ personaId: 'persona', worldId: null, query: '问题', limit: 5 })).resolves.toEqual(evidence)
  })
})
