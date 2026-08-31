import { createHash } from 'node:crypto'
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

  /** @returns 当前测试没有需要主动对账的 User。 */
  async listTargetUserIds() { return [] }

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
      complete: true,
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

  /** @returns 当前单元测试不重置 Session 投影。 */
  async markSessionsForRebuild() {}

  /** @returns 当前单元测试不保存 Session 状态。 */
  async saveSessionState() {}

  /** @returns 当前单元测试不保存 Session 结果。 */
  async saveSessionResult() {}

  /** @returns 当前单元测试不执行反馈资料最终清理。 */
  async finalizePersonaFeedbackSourceDeletion() {}

  /** @returns 同步记录副本。 */
  async listSyncRecords() { return [...this.records] }

  /** @param input 分页参数。 @returns 当前测试同步记录的分页结果。 */
  async listSyncRecordsPage(input: { page: number, pageSize: 5 | 10 | 20 | 50 | 100 }) {
    const total = this.records.length
    const totalPages = Math.max(1, Math.ceil(total / input.pageSize))
    const page = Math.min(input.page, totalPages)
    return {
      items: this.records.slice((page - 1) * input.pageSize, page * input.pageSize),
      total,
      page,
      pageSize: input.pageSize,
      totalPages,
    }
  }

  /** @returns 当前测试同步失败记录数。 */
  async countFailedSyncRecords() { return this.records.filter(record => record.status === 'failed').length }

  /** @returns 当前测试固定为无失败且同步健康。 */
  async getSyncSummary() {
    return {
      failedCount: 0,
      retryingCount: 0,
      attentionCount: 0,
      runtime: { state: 'healthy' as const, consecutiveFailures: 0, retryAfter: null, lastError: null, updatedAt: null },
    }
  }

  /** @returns 当前测试固定的健康同步运行状态。 */
  async getSyncRuntime() {
    return { state: 'healthy' as const, consecutiveFailures: 0, retryAfter: null, lastError: null, updatedAt: null }
  }

  /** @returns 当前测试不持久化同步降级状态。 */
  async markSyncDegraded() { return await this.getSyncRuntime() }

  /** @returns 当前测试不持久化同步恢复状态。 */
  async markSyncHealthy() { return await this.getSyncRuntime() }

  /** @returns 当前测试不调整同步重试时间。 */
  async allowImmediateSyncRetry() {}

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
  async checkHealth() { return { healthy: true, version: 'test', authMode: 'api_key' as const, queueHealthy: true } }
}

/** 测试固定资料 UUID。 */
const SOURCE_ID = '00000000-0000-4000-8000-000000000001'

describe('OpenViking 原生 HTTP 上下文适配器', () => {
  it('只接受能够管理当前 Account User 的 ADMIN Key', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [{ user_id: 'default', role: 'admin' }] })),
      healthyQueueResponse(),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true,
      endpoint: 'https://ov.test',
      apiKey: 'admin-key',
      timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
        return responses.shift()!
      }) as unknown as typeof fetch,
    })

    await expect(provider.checkHealth()).resolves.toEqual({ healthy: true, version: '0.4.16', authMode: 'api_key', queueHealthy: true })
    expect(requests.map(item => new URL(item.url).pathname)).toEqual([
      '/health', '/api/v1/admin/accounts/ren-yang/users', '/api/v1/observer/queue',
    ])
    expect(new Headers(requests[1]!.init.headers).get('x-api-key')).toBe('admin-key')
  })

  it('数据库配置从关闭切换到启用后立即生效且更换 ADMIN Key 会重新检测权限', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [] })),
      healthyQueueResponse(),
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.17', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [] })),
      healthyQueueResponse(),
    ]
    let configuration = { enabled: false, endpoint: '', apiKey: '', timeoutMs: 5_000 }
    const provider = new OpenVikingHttpContextProvider({
      ...configuration,
      repository: new FixedContextIndexRepository([]),
      configurationSource: () => configuration,
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
        return responses.shift()!
      }) as unknown as typeof fetch,
    })

    expect(provider.getCapability()).toMatchObject({ configured: false, enabled: false })
    configuration = { enabled: true, endpoint: 'https://first-ov.test', apiKey: 'first-admin-key', timeoutMs: 5_000 }
    await expect(provider.checkHealth()).resolves.toEqual({ healthy: true, version: '0.4.16', authMode: 'api_key', queueHealthy: true })

    configuration = { enabled: true, endpoint: 'https://second-ov.test', apiKey: 'second-admin-key', timeoutMs: 5_000 }
    await expect(provider.checkHealth()).resolves.toEqual({ healthy: true, version: '0.4.17', authMode: 'api_key', queueHealthy: true })

    expect(requests.map(request => new URL(request.url).origin)).toEqual([
      'https://first-ov.test', 'https://first-ov.test', 'https://first-ov.test',
      'https://second-ov.test', 'https://second-ov.test', 'https://second-ov.test',
    ])
    expect(requests.filter(request => new URL(request.url).pathname.includes('/admin/')).map(request => {
      return new Headers(request.init.headers).get('x-api-key')
    })).toEqual(['first-admin-key', 'second-admin-key'])
  })

  it('把反馈写入世界 User Session，消息携带人物 Peer 且只允许提取 events', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const memoryUri = 'viking://~/peers/persona-persona/memories/events/event-1.md'
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [] })),
      new Response(JSON.stringify({ status: 'ok', result: { account_id: 'ren-yang', user_id: 'world-world', user_key: 'world-key' } })),
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
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000,
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

    const createBody = JSON.parse(String(requests[4]!.init.body))
    expect(createBody.memory_policy).toEqual({
      self: { enabled: false }, peer: { enabled: true }, memory_types: ['events'], working_memory: { enabled: false },
    })
    expect(JSON.parse(String(requests[5]!.init.body))).toMatchObject({ role: 'user', peer_id: 'persona-persona' })
    expect(JSON.parse(String(requests[6]!.init.body))).toMatchObject({ role: 'assistant', peer_id: 'persona-persona' })
    const headers = new Headers(requests[5]!.init.headers)
    expect(headers.get('x-api-key')).toBe('world-key')
    expect(headers.get('x-openviking-account')).toBeNull()
    expect(headers.get('x-openviking-user')).toBeNull()
    expect(headers.get('x-openviking-actor-peer')).toBe('persona-persona')
  })

  it('按稳定资料 URI 删除远端资源，并把远端不存在视为成功', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [{ user_id: 'world-world', role: 'user' }] })),
      new Response(JSON.stringify({ status: 'ok', result: { user_key: 'world-key' } })),
      new Response(JSON.stringify({ status: 'ok', result: { status: 'success' } })),
      new Response(JSON.stringify({ status: 'error', error: { code: 'NOT_FOUND' } }), { status: 404 }),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true,
      endpoint: 'https://ov.test',
      apiKey: 'admin-key',
      timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
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

    expect(requests.slice(3).map((value) => {
      const url = new URL(value.url)
      return { path: url.pathname, uri: url.searchParams.get('uri'), recursive: url.searchParams.get('recursive'), wait: url.searchParams.get('wait') }
    })).toEqual([
      { path: '/api/v1/fs', uri: `viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`, recursive: 'false', wait: 'true' },
      { path: '/api/v1/fs', uri: `viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`, recursive: 'false', wait: 'true' },
    ])
    expect(new Headers(requests[3]!.init.headers).get('x-api-key')).toBe('world-key')
  })

  it('按 temp_upload、wait=true 资源写入和限定 URI 检索契约转换统一证据', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [] })),
      healthyQueueResponse(),
      new Response(JSON.stringify({ status: 'ok', result: { account_id: 'ren-yang', user_id: 'world-world', user_key: 'world-key' } })),
      new Response(JSON.stringify({ status: 'ok', result: '旧正文' })),
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
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000, repository, fetcher,
    })

    await expect(provider.checkHealth()).resolves.toEqual({ healthy: true, version: '0.4.16', authMode: 'api_key', queueHealthy: true })
    await expect(provider.synchronizeProjection({
      source: { entityType: 'source_material', id: SOURCE_ID, name: '原著资料', role: 'canon_fact', contentHash: 'a'.repeat(64), contentText: '原著资料正文。' },
      scopeType: 'persona', scopeId: 'persona', userId: 'world-world', peerId: 'persona-persona', priority: 10,
      operation: 'upsert', remoteUri: `viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`,
    })).resolves.toBe(`viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`)
    await expect(provider.search({ personaId: 'persona', worldId: null, query: '证据', limit: 5 })).resolves.toEqual({
      provider: 'openviking',
      candidates: [{
        entityType: 'source',
        entityId: SOURCE_ID,
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
      '/health', '/api/v1/admin/accounts/ren-yang/users', '/api/v1/observer/queue', '/api/v1/admin/accounts/ren-yang/users',
      '/api/v1/content/read', '/api/v1/fs', '/api/v1/resources/temp_upload', '/api/v1/resources', '/api/v1/search/find',
    ])
    expect(new Headers(requests[6]!.init.headers).get('x-api-key')).toBe('world-key')
    expect(requests[6]!.init.body).toBeInstanceOf(FormData)
    expect(JSON.parse(String(requests[7]!.init.body))).toMatchObject({
      temp_file_id: 'temp-1',
      to: `viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`,
      reason: '',
      wait: true,
      strict: true,
      tags: [`source_id=${SOURCE_ID}`, 'entity_type=source_material', 'source_role=canon_fact', 'scope_type=persona', 'scope_id=persona'],
    })
    expect(JSON.parse(String(requests[8]!.init.body))).toEqual({
      query: '证据',
      target_uri: [`viking://~/peers/persona-persona/resources/ren-yang/persona-source/${SOURCE_ID}.md`],
      context_type: 'resource',
      limit: 5,
      read_content: true,
    })
  })

  it('远端原文哈希已一致时直接确认同步且不重复删除上传', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [] })),
      new Response(JSON.stringify({ status: 'ok', result: { account_id: 'ren-yang', user_id: 'world-a', user_key: 'key-a' } })),
      new Response(JSON.stringify({ status: 'ok', result: '正文' })),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
        return responses.shift()!
      }) as unknown as typeof fetch,
    })
    const remoteUri = `viking://~/resources/ren-yang/world-source/${SOURCE_ID}.md`

    await expect(provider.synchronizeProjection({
      source: {
        entityType: 'source_material', id: SOURCE_ID, name: '资料', role: 'reference',
        contentHash: createHash('sha256').update('正文').digest('hex'), contentText: '正文',
      },
      scopeType: 'world', scopeId: 'world-a', userId: 'world-a', peerId: null,
      priority: 10, operation: 'upsert', remoteUri,
    })).resolves.toBe(remoteUri)

    expect(requests.map(item => new URL(item.url).pathname)).toEqual([
      '/health', '/api/v1/admin/accounts/ren-yang/users',
      '/api/v1/admin/accounts/ren-yang/users', '/api/v1/content/read',
    ])
  })

  it('两个世界分别创建 User，并使用各自 User Key 访问数据接口', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [] })),
      new Response(JSON.stringify({ status: 'ok', result: { account_id: 'ren-yang', user_id: 'world-a', user_key: 'key-a' } })),
      new Response(JSON.stringify({ status: 'error' }), { status: 404 }),
      new Response(JSON.stringify({ status: 'ok', result: { temp_file_id: 'temp-a' } })),
      new Response(JSON.stringify({ status: 'ok', result: { root_uri: `viking://~/resources/ren-yang/world-source/${SOURCE_ID}.md` } })),
      new Response(JSON.stringify({ status: 'ok', result: { account_id: 'ren-yang', user_id: 'world-b', user_key: 'key-b' } })),
      new Response(JSON.stringify({ status: 'error' }), { status: 404 }),
      new Response(JSON.stringify({ status: 'ok', result: { temp_file_id: 'temp-b' } })),
      new Response(JSON.stringify({ status: 'ok', result: { root_uri: `viking://~/resources/ren-yang/world-source/${SOURCE_ID}.md` } })),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
        return responses.shift()!
      }) as unknown as typeof fetch,
    })
    const projection = (userId: string) => ({
      source: { entityType: 'source_material' as const, id: SOURCE_ID, name: '资料', role: 'reference' as const, contentHash: 'a'.repeat(64), contentText: '正文' },
      scopeType: 'world' as const, scopeId: userId, userId, peerId: null, priority: 10, operation: 'upsert' as const,
      remoteUri: `viking://~/resources/ren-yang/world-source/${SOURCE_ID}.md`,
    })

    await provider.synchronizeProjection(projection('world-a'))
    await provider.synchronizeProjection(projection('world-b'))

    expect(new Headers(requests[4]!.init.headers).get('x-api-key')).toBe('key-a')
    expect(new Headers(requests[8]!.init.headers).get('x-api-key')).toBe('key-b')
    expect(requests.filter(item => new URL(item.url).pathname === '/api/v1/admin/accounts/ren-yang/users')).toHaveLength(3)
  })

  it('User 对账删除 SQLite 已不存在的受管 User，并创建或刷新当前 User', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [
        { user_id: 'default', role: 'admin' },
        { user_id: 'world-current', role: 'user' },
        { user_id: 'world-orphan', role: 'user' },
      ] })),
      new Response(JSON.stringify({ status: 'ok', result: { deleted: true } })),
      new Response(JSON.stringify({ status: 'ok', result: { account_id: 'ren-yang', user_id: 'standalone-new', user_key: 'new-key' } })),
      new Response(JSON.stringify({ status: 'ok', result: { user_key: 'current-key' } })),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
        return responses.shift()!
      }) as unknown as typeof fetch,
    })

    await provider.reconcileUsers(['world-current', 'standalone-new'])

    expect(requests.map(item => `${item.init.method ?? 'GET'} ${new URL(item.url).pathname}`)).toEqual([
      'GET /health',
      'GET /api/v1/admin/accounts/ren-yang/users',
      'DELETE /api/v1/admin/accounts/ren-yang/users/world-orphan',
      'POST /api/v1/admin/accounts/ren-yang/users',
      'POST /api/v1/admin/accounts/ren-yang/users/world-current/key',
    ])
    expect(requests.slice(1).every(item => new Headers(item.init.headers).get('x-api-key') === 'admin-key')).toBe(true)
  })

  it('清理 default 旧数据时先删除 Session，再删除其引用的 Peer', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const peerUri = 'viking://user/default/peers/persona-old'
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [{ user_id: 'default', role: 'admin' }] })),
      new Response(JSON.stringify({ status: 'ok', result: [{ name: 'world-source', uri: 'viking://user/default/resources/ren-yang/world-source', isDir: true }] })),
      new Response(JSON.stringify({ status: 'ok', result: { deleted: true } })),
      new Response(JSON.stringify({ status: 'ok', result: [{ session_id: 'ren-yang-run-old' }] })),
      new Response(JSON.stringify({ status: 'ok', result: { deleted: true } })),
      new Response(JSON.stringify({ status: 'ok', result: [{ name: 'persona-old', uri: peerUri, isDir: true }] })),
      new Response(JSON.stringify({ status: 'ok', result: { deleted: true } })),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
        return responses.shift()!
      }) as unknown as typeof fetch,
    })

    await provider.resetLegacyIndex()

    expect(requests.map(item => `${item.init.method ?? 'GET'} ${new URL(item.url).pathname}`)).toEqual([
      'GET /health',
      'GET /api/v1/admin/accounts/ren-yang/users',
      'GET /api/v1/fs/ls',
      'DELETE /api/v1/fs',
      'GET /api/v1/sessions',
      'DELETE /api/v1/sessions/ren-yang-run-old',
      'GET /api/v1/fs/ls',
      'DELETE /api/v1/fs',
    ])
  })

  it('全量重建保留既有 User，只刷新 Key 并原位清理受管内容', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [{ user_id: 'world-a', role: 'user' }] })),
      new Response(JSON.stringify({ status: 'ok', result: { user_key: 'key-a' } })),
      new Response(JSON.stringify({ status: 'error', error: { code: 'NOT_FOUND' } }), { status: 404 }),
      new Response(JSON.stringify({ status: 'ok', result: [] })),
      new Response(JSON.stringify({ status: 'error', error: { code: 'NOT_FOUND' } }), { status: 404 }),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
        return responses.shift()!
      }) as unknown as typeof fetch,
    })

    await provider.rebuildUsers(['world-a'])

    expect(requests.some(item => item.init.method === 'DELETE' && new URL(item.url).pathname.includes('/admin/accounts/'))).toBe(false)
    expect(requests.map(item => `${item.init.method ?? 'GET'} ${new URL(item.url).pathname}`)).toContain(
      'POST /api/v1/admin/accounts/ren-yang/users/world-a/key',
    )
  })

  it('全量重建递归删除受管资料根时不等待语义队列', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [{ user_id: 'world-a', role: 'user' }] })),
      new Response(JSON.stringify({ status: 'ok', result: { user_key: 'key-a' } })),
      new Response(JSON.stringify({ status: 'ok', result: [{ name: 'world-source', uri: 'viking://~/resources/ren-yang/world-source', isDir: true }] })),
      new Response(JSON.stringify({ status: 'ok', result: { uri: 'viking://~/resources/ren-yang', semantic_status: 'queued' } })),
      new Response(JSON.stringify({ status: 'ok', result: [] })),
      new Response(JSON.stringify({ status: 'ok', result: [{ name: 'persona-a', uri: 'viking://~/peers/persona-a', isDir: true }] })),
      new Response(JSON.stringify({ status: 'ok', result: { uri: 'viking://~/peers/persona-a', semantic_status: 'queued' } })),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
        return responses.shift()!
      }) as unknown as typeof fetch,
    })

    await provider.rebuildUsers(['world-a'])

    const recursiveDeletions = requests.filter(item => item.init.method === 'DELETE' && new URL(item.url).pathname === '/api/v1/fs')
    expect(recursiveDeletions).toHaveLength(2)
    expect(recursiveDeletions.every(item => new URL(item.url).searchParams.get('recursive') === 'true')).toBe(true)
    expect(recursiveDeletions.every(item => new URL(item.url).searchParams.get('wait') === 'false')).toBe(true)
  })

  it('删除旧投影时不会重新创建已被对账删除的 User', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [] })),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
        return responses.shift()!
      }) as unknown as typeof fetch,
    })

    await provider.deleteProjection({
      id: 'sync-a', entityType: 'source_material', sourceId: SOURCE_ID,
      scopeType: 'world', scopeId: 'a', userId: 'world-a', peerId: null,
      provider: 'openviking', remoteUri: `viking://~/resources/ren-yang/world-source/${SOURCE_ID}.md`,
      contentHash: 'a'.repeat(64), status: 'synchronized', operation: 'upsert', error: null,
      createdAt: 1, updatedAt: 1,
    })

    expect(requests.some(item => item.init.method === 'POST' || item.init.method === 'DELETE')).toBe(false)
  })

  it('创建刚删除的 User 遇到 412 时在维护窗口内重试', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [] })),
      new Response(JSON.stringify({ status: 'error', error: { code: 'PRECONDITION_FAILED' } }), { status: 412 }),
      new Response(JSON.stringify({ status: 'ok', result: { account_id: 'ren-yang', user_id: 'world-a', user_key: 'key-a' } })),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
        return responses.shift()!
      }) as unknown as typeof fetch,
    })

    await provider.reconcileUsers(['world-a'])

    expect(requests.filter(item => new URL(item.url).pathname === '/api/v1/admin/accounts/ren-yang/users' && item.init.method === 'POST'))
      .toHaveLength(2)
  })

  it('进程内 User 状态过期时按 SQLite 目标标识重新创建', async () => {
    const requests: Array<{ url: string, init: RequestInit }> = []
    const responses = [
      new Response(JSON.stringify({ status: 'ok', healthy: true, version: '0.4.16', auth_mode: 'api_key' })),
      new Response(JSON.stringify({ status: 'ok', result: [{ user_id: 'world-a', role: 'user' }] })),
      new Response(JSON.stringify({ status: 'error', error: { code: 'NOT_FOUND' } }), { status: 404 }),
      new Response(JSON.stringify({ status: 'ok', result: { account_id: 'ren-yang', user_id: 'world-a', user_key: 'new-key' } })),
    ]
    const provider = new OpenVikingHttpContextProvider({
      enabled: true, endpoint: 'https://ov.test', apiKey: 'admin-key', timeoutMs: 5_000,
      repository: new FixedContextIndexRepository([]),
      fetcher: vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} })
        return responses.shift()!
      }) as unknown as typeof fetch,
    })

    await provider.reconcileUsers(['world-a'])

    expect(requests.map(item => `${item.init.method ?? 'GET'} ${new URL(item.url).pathname}`)).toContain(
      'POST /api/v1/admin/accounts/ren-yang/users',
    )
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
      entityType: 'source', entityId: SOURCE_ID,
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

/** @returns 模拟 OpenViking 资源处理队列健康的标准响应。 */
function healthyQueueResponse(): Response {
  return new Response(JSON.stringify({
    status: 'ok',
    result: { name: 'queue', is_healthy: true, has_errors: false },
  }))
}
