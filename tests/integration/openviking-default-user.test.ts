import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { ContextSynchronizationApplicationService } from '../../server/application/context/ContextSynchronizationApplicationService'
import { SqliteContextIndexRepository } from '../../server/infrastructure/database/SqliteContextIndexRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import type { Clock } from '../../server/ports/Clock'
import type { ContextSyncTaskQueue } from '../../server/ports/ContextSyncTaskQueue'
import type { IdentifierGenerator } from '../../server/ports/IdentifierGenerator'
import type { OpenVikingPort } from '../../server/ports/OpenVikingPort'

/** 测试固定时钟。 */
class FixedClock implements Clock {
  /** @returns 固定 UTC Unix 毫秒。 */
  now(): number { return 2_000 }
}

/** 测试固定标识生成器。 */
class FixedIdentifierGenerator implements IdentifierGenerator {
  /** @returns 固定 UUID。 */
  create(): string { return '00000000-0000-4000-8000-000000000999' }
}

/** 当前测试 SQLite 数据目录。 */
let temporaryDirectory: string
/** 当前测试数据库。 */
let database: SqliteDatabase

beforeEach(() => {
  temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-openviking-default-user-'))
  database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
})

afterEach(() => {
  database.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('OpenViking default User 映射', () => {
  it('只为世界创建业务 User且无世界人物使用 default', async () => {
    database.getClient().prepare(`
      INSERT INTO worlds (id, name, summary, active_soul_version_id, created_at, updated_at)
      VALUES ('world-id', '测试世界', '', NULL, 1000, 1000)
    `).run()
    database.getClient().prepare(`
      INSERT INTO personas (id, world_id, name, origin, active_soul_version_id, created_at, updated_at)
      VALUES ('persona-id', NULL, '独立人物', 'original', NULL, 1000, 1000)
    `).run()
    database.getClient().prepare(`
      INSERT INTO source_materials (
        id, name, role, input_type, content_hash, content_text, original_file_path, created_at, updated_at
      ) VALUES ('source-id', '人物资料', 'canon_fact', 'paste', ?, '资料正文', NULL, 1000, 1000)
    `).run('a'.repeat(64))
    database.getClient().prepare(`
      INSERT INTO persona_sources (persona_id, source_id, priority)
      VALUES ('persona-id', 'source-id', 10)
    `).run()
    const repository = new SqliteContextIndexRepository(database.getClient())

    await expect(repository.listTargetUserIds()).resolves.toEqual(['world-world-id'])
    await expect(repository.listSourceProjections('source_material', 'source-id')).resolves.toEqual([
      expect.objectContaining({ userId: 'default', peerId: 'persona-persona-id' }),
    ])
    await expect(repository.findRemoteSearchScope('persona-id', null)).resolves.toMatchObject({
      userId: 'default', peerId: 'persona-persona-id', complete: false,
    })
  })

  it('主动检测成功后解除历史全局降级状态', async () => {
    const repository = new SqliteContextIndexRepository(database.getClient())
    await repository.markSyncDegraded('历史单项资料错误', null, 1_000)
    const openViking = {
      /** @returns 固定启用能力。 */
      getCapability: () => ({ configured: true, enabled: true, provider: 'openviking' as const, endpointOrigin: 'https://ov.test' }),
      /** @returns 当前服务和队列接口可达。 */
      checkHealth: async () => ({ healthy: true, version: '0.4.16', authMode: 'api_key' as const, queueHealthy: true }),
    } as unknown as OpenVikingPort
    const service = new ContextSynchronizationApplicationService({
      repository,
      openViking,
      identifiers: new FixedIdentifierGenerator(),
      clock: new FixedClock(),
    })

    await expect(service.checkProvider()).resolves.toMatchObject({ healthy: true, queueHealthy: true })
    await expect(repository.getSyncRuntime()).resolves.toMatchObject({
      state: 'healthy', consecutiveFailures: 0, retryAfter: null, lastError: null, updatedAt: 2_000,
    })
  })

  it('启动补偿自动修复旧版本误判的嵌入长度降级', async () => {
    const repository = new SqliteContextIndexRepository(database.getClient())
    await repository.markSyncDegraded(
      "OpenViking 请求失败：{'type': 'exceed_context_size_error'}",
      null,
      1_000,
    )
    const queuedTasks: string[] = []
    const taskQueue = {
      /** @returns 记录一次 User 对账任务。 */
      enqueueUserReconciliation: async () => { queuedTasks.push('users') },
      /** @returns 当前测试没有资料任务。 */
      enqueueSourceSynchronization: async () => {},
      /** @returns 当前测试没有 Session 任务。 */
      enqueueSessionSynchronization: async () => {},
    } as ContextSyncTaskQueue
    const openViking = {
      /** @returns 固定启用能力。 */
      getCapability: () => ({ configured: true, enabled: true, provider: 'openviking' as const, endpointOrigin: 'https://ov.test' }),
    } as unknown as OpenVikingPort
    const service = new ContextSynchronizationApplicationService({
      repository,
      openViking,
      identifiers: new FixedIdentifierGenerator(),
      clock: new FixedClock(),
      taskQueue,
    })

    await service.recoverPendingTasks()

    await expect(repository.getSyncRuntime()).resolves.toMatchObject({ state: 'healthy', lastError: null })
    expect(queuedTasks).toEqual(['users'])
  })
})
