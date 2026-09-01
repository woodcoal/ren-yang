import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiKeyApplicationService } from '../../server/application/authentication/ApiKeyApplicationService'
import { PublicApiApplicationService } from '../../server/application/publicApi/PublicApiApplicationService'
import { SqliteApiKeyRepository } from '../../server/infrastructure/database/SqliteApiKeyRepository'
import { SqliteAuditRepository } from '../../server/infrastructure/database/SqliteAuditRepository'
import { SqlitePublicApiRepository } from '../../server/infrastructure/database/SqlitePublicApiRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'

let directory: string
let database: SqliteDatabase
let timestamp: number
let identifierOrdinal: number
let secretOrdinal: number

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-api-key-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  timestamp = Date.parse('2026-09-01T08:00:00.000Z')
  identifierOrdinal = 0
  secretOrdinal = 0
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

/**
 * 创建使用确定性时间、标识和密钥的 API Key 应用服务。
 * @returns 可验证摘要存储和认证状态的应用服务。
 */
function createService(): ApiKeyApplicationService {
  return new ApiKeyApplicationService({
    repository: new SqliteApiKeyRepository(database.getClient()),
    identifiers: {
      create: () => `00000000-0000-4000-8000-${String(++identifierOrdinal).padStart(12, '0')}`,
    },
    clock: { now: () => timestamp },
    generateSecret: () => {
      secretOrdinal += 1
      return `ry_v2_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG${secretOrdinal === 1 ? '' : secretOrdinal}`
    },
  })
}

describe('API Key 管理', () => {
  it('创建时仅返回一次明文，并且数据库只保存不可逆摘要', async () => {
    const service = createService()

    const created = await service.create({
      name: '资料同步脚本',
      scopes: ['persona:read', 'library:write'],
      expiresAt: null,
    })

    expect(created.secret).toBe('ry_v2_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG')
    expect(created.key.prefix).toBe('ry_v2_abcdef')
    expect(created.key.status).toBe('active')
    expect(await service.list()).toEqual([created.key])

    const persisted = database.getClient().prepare(`SELECT key_digest, key_prefix, scopes_json FROM api_keys`).get()
    expect(persisted).toEqual({
      key_digest: 'e4cbe6e16f6ff10e5c3a0331df485a6aa559982f7e559e44e141ec263d3cb47e',
      key_prefix: 'ry_v2_abcdef',
      scopes_json: '["persona:read","library:write"]',
    })
    expect(JSON.stringify(persisted)).not.toContain(created.secret)
  })

  it('有效 Key 可认证并更新最近使用时间，权限不足返回 403', async () => {
    const service = createService()
    const created = await service.create({ name: '只读人物', scopes: ['persona:read'], expiresAt: null })
    timestamp += 5_000

    const principal = await service.authenticate(created.secret)

    expect(principal).toMatchObject({ id: created.key.id, scopes: ['persona:read'] })
    await expect(service.requireScope(principal, 'persona:write')).rejects.toMatchObject({
      code: 'API_SCOPE_INSUFFICIENT',
      statusCode: 403,
    })
    expect((await service.list())[0]?.lastUsedAt).toBe(timestamp)
  })

  it('无效、过期和吊销 Key 均返回统一 401，吊销后下一次请求立即失效', async () => {
    const service = createService()
    await expect(service.authenticate('ry_v2_invalid')).rejects.toMatchObject({
      code: 'API_KEY_INVALID',
      statusCode: 401,
    })

    const expired = await service.create({
      name: '短期 Key',
      scopes: ['world:read'],
      expiresAt: new Date(timestamp + 1_000).toISOString(),
    })
    timestamp += 2_000
    await expect(service.authenticate(expired.secret)).rejects.toMatchObject({ code: 'API_KEY_INVALID', statusCode: 401 })

    const active = await service.create({ name: '待吊销 Key', scopes: ['library:read'], expiresAt: null })
    await expect(service.authenticate(active.secret)).resolves.toMatchObject({ id: active.key.id })
    await service.revoke(active.key.id)
    await expect(service.authenticate(active.secret)).rejects.toMatchObject({ code: 'API_KEY_INVALID', statusCode: 401 })
    expect((await service.list()).find(item => item.id === active.key.id)?.status).toBe('revoked')
  })
})

describe('公共 API 幂等与审计', () => {
  it('相同请求永久复用首次结果，载荷变化时返回 409', async () => {
    const apiKeys = createService()
    const created = await apiKeys.create({ name: '批量维护', scopes: ['persona:write'], expiresAt: null })
    const repository = new SqlitePublicApiRepository(database.getClient())
    const service = new PublicApiApplicationService({
      repository,
      identifiers: { create: () => `10000000-0000-4000-8000-${String(++identifierOrdinal).padStart(12, '0')}` },
      clock: { now: () => timestamp },
    })
    let executions = 0

    const first = await service.executeIdempotent({
      apiKeyId: created.key.id,
      method: 'POST',
      path: '/api/v2/personas',
      idempotencyKey: 'create-persona-001',
      payload: { name: '林默' },
      action: async () => ({ id: `persona-${++executions}`, name: '林默' }),
    })
    const repeated = await service.executeIdempotent({
      apiKeyId: created.key.id,
      method: 'POST',
      path: '/api/v2/personas',
      idempotencyKey: 'create-persona-001',
      payload: { name: '林默' },
      action: async () => ({ id: `persona-${++executions}`, name: '林默' }),
    })

    expect(first).toEqual({ data: { id: 'persona-1', name: '林默' }, replayed: false })
    expect(repeated).toEqual({ data: { id: 'persona-1', name: '林默' }, replayed: true })
    expect(executions).toBe(1)
    await expect(service.executeIdempotent({
      apiKeyId: created.key.id,
      method: 'POST', path: '/api/v2/personas', idempotencyKey: 'create-persona-001',
      payload: { name: '不同人物' }, action: async () => ({ id: 'never' }),
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 })
  })

  it('公共写操作审计不包含 Key 明文和业务正文', async () => {
    const apiKeys = createService()
    const created = await apiKeys.create({ name: '资料维护', scopes: ['library:write'], expiresAt: null })
    const service = new PublicApiApplicationService({
      repository: new SqlitePublicApiRepository(database.getClient()),
      identifiers: { create: () => `20000000-0000-4000-8000-${String(++identifierOrdinal).padStart(12, '0')}` },
      clock: { now: () => timestamp },
    })

    await service.recordAudit({
      apiKeyId: created.key.id,
      requestId: 'request-001',
      method: 'POST',
      path: '/api/v2/sources',
      targetType: 'source',
      targetId: 'source-001',
      result: 'succeeded',
      statusCode: 201,
      errorCode: null,
    })

    const rows = database.getClient().prepare(`SELECT * FROM public_api_audit_events`).all()
    expect(rows).toEqual([expect.objectContaining({
      api_key_id: created.key.id,
      request_id: 'request-001',
      method: 'POST',
      path: '/api/v2/sources',
      target_type: 'source',
      target_id: 'source-001',
      result: 'succeeded',
      status_code: 201,
    })])
    expect(JSON.stringify(rows)).not.toContain(created.secret)
    expect(JSON.stringify(rows)).not.toContain('资料正文')

    const visibleAudit = await new SqliteAuditRepository(database.getClient()).list(10)
    expect(visibleAudit).toEqual(expect.arrayContaining([expect.objectContaining({
      actor: 'api_key',
      action: 'public_api_request',
      targetType: 'source',
      targetId: 'source-001',
      details: expect.objectContaining({ apiKeyId: created.key.id, requestId: 'request-001', result: 'succeeded' }),
    })]))
  })
})
