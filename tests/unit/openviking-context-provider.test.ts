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

  /** @returns 当前测试不需要资料投影列表。 */
  async listSourceProjections() { return [] }

  /** @returns 固定人物资料范围。 */
  async listSourceScopes() { return this.scopes }

  /** @returns 把固定范围映射为当前世界 User 下的已同步 URI。 */
  async findRemoteSearchScope() {
    return {
      userId: 'world-world',
      peerId: 'persona-persona',
      targets: this.scopes.map(scope => ({
        ...scope,
        remoteUri: `viking://~/peers/persona-persona/resources/ren-yang/persona-source/${scope.sourceId}.md`,
      })),
    }
  }

  /** @returns 当前测试不注入本地有效成长或记忆。 */
  async listActiveLocalLearning() { return [] }

  /** @returns 当前单元测试不需要 Session 事实。 */
  async findSessionExchange() { return null }

  /** @returns 当前单元测试没有待补偿 Session。 */
  async listPendingSessionSources() { return [] }

  /** @returns 当前单元测试不保存 Session 状态。 */
  async saveSessionState() {}

  /** @returns 当前单元测试不保存 Session 结果。 */
  async saveSessionResult() {}

  /** @returns 当前单元测试不执行反馈资料最终清理。 */
  async finalizePersonaFeedbackSourceDeletion() {}

  /** @returns 同步记录副本。 */
  async listSyncRecords() { return [...this.records] }

  /** @param record 新同步记录。 @returns 无返回值。 */
  async saveSyncRecord(record: ContextSyncRecordView) { this.records = [record] }

  /** @returns 删除测试同步记录。 */
  async deleteSyncRecord() {}
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
  async search() { return { provider: this.provider, candidates: this.evidence } }

  /** @returns 固定健康结果。 */
  async checkHealth() { return { healthy: true, version: 'test', authMode: 'trusted' as const } }
}

/** 测试固定资料 UUID。 */
const SOURCE_ID = '00000000-0000-4000-8000-000000000001'

describe('OpenViking 原生 HTTP 上下文适配器', () => {
  it('拒绝不能按世界动态切换 User 的 API Key 认证模式', async () => {
    const provider = new OpenVikingHttpContextProvider({
      enabled: true,
      endpoint: 'https://ov.test',
      apiKey: 'user-key',
      timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async () => new Response(JSON.stringify({
        status: 'ok', healthy: true, version: '0.4.17', auth_mode: 'api_key',
      }))) as unknown as typeof fetch,
    })

    await expect(provider.checkHealth()).rejects.toMatchObject({
      code: 'CAPABILITY_DISABLED',
      message: 'OpenViking 必须启用 Trusted 认证模式，API Key 模式无法按世界隔离数据',
    })
  })

  it('把反馈写入世界 User Session，消息携带人物 Peer 且只允许提取 events', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const memoryUri = 'viking://~/peers/persona-persona/memories/events/event-1.md'
    const responses = [
      new Response(JSON.stringify({ status: 'error' }), { status: 404 }),
      new Response(JSON.stringify({ status: 'ok', result: { session_id: 'session-1' } })),
      new Response(JSON.stringify({ status: 'ok', result: { message_count: 1 } })),
      new Response(JSON.stringify({ status: 'ok', result: { message_count: 2 } })),
      new Response(JSON.stringify({ status: 'ok', result: { task_id: 'task-1' } })),
      new Response(JSON.stringify({ status: 'ok', result: { status: 'completed' } })),
      new Response(JSON.stringify({ status: 'ok', result: [{ name: 'event-1.md', uri: memoryUri, isDir: false }] })),
      new Response(JSON.stringify({ status: 'ok', result: '人物明确要求以后少用反问。' })),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'trusted-key', timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
        return responses.shift()!
      }) as unknown as typeof fetch,
    })

    await expect(provider.synchronizeSession({
      sourceType: 'feedback', sourceId: 'feedback-1', personaId: 'persona',
      userId: 'world-world', peerId: 'persona-persona', sessionId: 'session-1',
      userContent: '以后少用反问。', assistantContent: '已记录。', extractMemory: true,
    })).resolves.toEqual([{
      remoteUri: memoryUri,
      memoryType: 'events',
      content: '人物明确要求以后少用反问。',
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }])

    const createBody = JSON.parse(String(requests[1]!.init.body))
    expect(createBody.memory_policy).toEqual({
      self: { enabled: false }, peer: { enabled: true }, memory_types: ['events'], working_memory: { enabled: false },
    })
    expect(JSON.parse(String(requests[2]!.init.body))).toMatchObject({ role: 'user', peer_id: 'persona-persona' })
    expect(JSON.parse(String(requests[3]!.init.body))).toMatchObject({ role: 'assistant', peer_id: 'persona-persona' })
    const headers = new Headers(requests[2]!.init.headers)
    expect(headers.get('x-openviking-account')).toBe('ren-yang')
    expect(headers.get('x-openviking-user')).toBe('world-world')
    expect(headers.get('x-openviking-actor-peer')).toBe('persona-persona')
  })

  it('按稳定资料 URI 删除远端资源，并把远端不存在视为成功', async () => {
    const requests: string[] = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', result: { status: 'success' } })),
      new Response(JSON.stringify({ status: 'error', error: { code: 'NOT_FOUND' } }), { status: 404 }),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true,
      endpoint: 'https://ov.test',
      apiKey: '',
      timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo) => {
        requests.push(String(input))
        return responses.shift()!
      }) as unknown as typeof fetch,
    })

    const record: ContextSyncRecordView = {
      id: 'record', entityType: 'source_material', sourceId: SOURCE_ID, scopeType: 'persona', scopeId: 'persona',
      userId: 'world-world', peerId: 'persona-persona', provider: 'openviking',
      remoteUri: `viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`,
      contentHash: 'a'.repeat(64), status: 'synchronized', operation: 'upsert', error: null, createdAt: 1, updatedAt: 1,
    }
    await expect(provider.deleteProjection(record)).resolves.toBeUndefined()
    await expect(provider.deleteProjection(record)).resolves.toBeUndefined()

    expect(requests.map((value) => {
      const url = new URL(value)
      return { path: url.pathname, uri: url.searchParams.get('uri'), recursive: url.searchParams.get('recursive'), wait: url.searchParams.get('wait') }
    })).toEqual([
      { path: '/api/v1/fs', uri: `viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`, recursive: 'false', wait: 'true' },
      { path: '/api/v1/fs', uri: `viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`, recursive: 'false', wait: 'true' },
    ])
  })

  it('按 temp_upload、wait=true 资源写入和限定 URI 检索契约转换统一证据', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.7.7', auth_mode: 'trusted' })),
      new Response(JSON.stringify({ status: 'error', error: { code: 'NOT_FOUND', message: 'not found' } }), { status: 404 }),
      new Response(JSON.stringify({ status: 'ok', result: { temp_file_id: 'temp-1' } })),
      new Response(JSON.stringify({ status: 'ok', result: { status: 'success', root_uri: `viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md` } })),
      new Response(JSON.stringify({
        status: 'ok',
        result: {
          resources: [{
            uri: `viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md/chunk-1`,
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

    await expect(provider.checkHealth()).resolves.toEqual({ healthy: true, version: '0.7.7', authMode: 'trusted' })
    await expect(provider.synchronizeProjection({
      source: { entityType: 'source_material', id: SOURCE_ID, name: '原著资料', role: 'canon_fact', contentHash: 'a'.repeat(64), contentText: '原著资料正文。' },
      scopeType: 'persona', scopeId: 'persona', userId: 'world-world', peerId: 'persona-persona', priority: 10,
      operation: 'upsert', remoteUri: `viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`,
    })).resolves.toBe(`viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`)
    await expect(provider.search({ personaId: 'persona', worldId: null, query: '证据', limit: 5 })).resolves.toEqual({
      provider: 'openviking',
      candidates: [{
        sourceId: SOURCE_ID,
        chunkId: null,
        role: 'canon_fact',
        heading: null,
        content: '这是 OpenViking 返回的证据正文。',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        priority: 10,
      }],
    })

    expect(requests.map(item => new URL(item.url).pathname)).toEqual([
      '/health', '/api/v1/fs', '/api/v1/resources/temp_upload', '/api/v1/resources', '/api/v1/search/find',
    ])
    expect(new Headers(requests[2]!.init.headers).get('x-api-key')).toBe('secret')
    expect(requests[2]!.init.body).toBeInstanceOf(FormData)
    expect(JSON.parse(String(requests[3]!.init.body))).toMatchObject({
      temp_file_id: 'temp-1',
      to: `viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`,
      reason: '',
      wait: true,
      strict: true,
      tags: [`source_id=${SOURCE_ID}`, 'entity_type=source_material', 'source_role=canon_fact', 'scope_type=persona', 'scope_id=persona'],
    })
    expect(JSON.parse(String(requests[4]!.init.body))).toEqual({
      query: '证据',
      target_uri: [`viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`],
      context_type: 'resource',
      limit: 5,
      read_content: true,
    })
  })

  it('运行创建前健康检查失败时固定使用 SQLite，运行内不再二次切换', async () => {
    const localSearch = vi.fn(async () => ({ provider: 'sqlite_fts5' as const, candidates: [] }))
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
      .resolves.toEqual({ provider: 'sqlite_fts5', candidates: [] })
    expect(localSearch).toHaveBeenCalledOnce()
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
    await expect(provider.search({ personaId: 'persona', worldId: null, query: '问题', limit: 5 }))
      .resolves.toEqual({ provider: 'sqlite_fts5', candidates: evidence })
  })
})
