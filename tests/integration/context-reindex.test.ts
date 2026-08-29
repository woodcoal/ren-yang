import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { ContextSynchronizationApplicationService } from '../../server/application/context/ContextSynchronizationApplicationService'
import { ContentApplicationService } from '../../server/application/content/ContentApplicationService'
import { TaskRoutingApplicationService } from '../../server/application/tasks/TaskRoutingApplicationService'
import { WorkerApplicationService } from '../../server/application/tasks/WorkerApplicationService'
import { LocalSourceFileStorage } from '../../server/infrastructure/content/LocalSourceFileStorage'
import { NodeSourceContentProcessor } from '../../server/infrastructure/content/NodeSourceContentProcessor'
import { SqliteContentRepository } from '../../server/infrastructure/database/SqliteContentRepository'
import { SqliteContextIndexRepository } from '../../server/infrastructure/database/SqliteContextIndexRepository'
import { SqliteContextSyncTaskQueue } from '../../server/infrastructure/database/SqliteContextSyncTaskQueue'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteTaskJobRepository } from '../../server/infrastructure/database/SqliteTaskJobRepository'
import type { Clock } from '../../server/ports/Clock'
import type { ContextSourceDocument } from '../../server/ports/ContextIndexRepository'
import type { IdentifierGenerator } from '../../server/ports/IdentifierGenerator'
import type { OpenVikingPort } from '../../server/ports/OpenVikingPort'
import { ApplicationError } from '../../server/application/errors/ApplicationError'

/** 测试使用的顺序 UUID。 */
class SequentialIdentifierGenerator implements IdentifierGenerator {
  /** 当前序号。 */
  private sequence = 0

  /** @returns 下一个可预测 UUID。 */
  create(): string {
    this.sequence += 1
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, '0')}`
  }
}

/** 测试使用的递增时钟。 */
class IncrementingClock implements Clock {
  /** 当前时间。 */
  private timestamp = 1_000

  /** @returns 下一个 UTC Unix 毫秒。 */
  now(): number {
    this.timestamp += 1
    return this.timestamp
  }
}

/** 用内存映射模拟可被清空的 OpenViking 远端索引。 */
class InMemoryOpenViking implements OpenVikingPort {
  /** 远端 URI 到资料正文。 */
  public readonly resources = new Map<string, string>()
  /** 重建删除次数。 */
  public resetCount = 0

  /** @param enabled 能力开关。 */
  constructor(private readonly enabled = true) {}

  /** @returns 固定能力配置。 */
  getCapability() {
    return { configured: true, enabled: this.enabled, provider: 'openviking' as const, endpointOrigin: 'http://openviking.test' }
  }

  /** @returns 固定健康状态。 */
  async checkHealth() { return { healthy: true, version: 'test' } }

  /** @returns 清空全部模拟远端资源。 */
  async resetIndex() {
    this.resetCount += 1
    this.resources.clear()
  }

  /** @param source SQLite 资料。 @returns 写入的稳定远端 URI。 */
  async synchronizeSource(source: ContextSourceDocument) {
    const uri = `viking://resources/ren-yang/${source.id}.md`
    this.resources.set(uri, source.contentText)
    return uri
  }
}

/** 当前测试数据目录。 */
let temporaryDirectory: string
/** 当前测试 SQLite。 */
let database: SqliteDatabase

beforeEach(() => {
  temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-context-test-'))
  database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
  database.getClient().prepare(`
    INSERT INTO source_materials (
      id, name, role, input_type, content_hash, content_text, original_file_path, created_at, updated_at
    ) VALUES ('00000000-0000-4000-8000-000000000001', '原著资料', 'canon_fact', 'paste', ?, '第一版正文。', NULL, 1000, 1000)
  `).run('a'.repeat(64))
})

afterEach(() => {
  database.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('OpenViking 可关闭索引与 SQLite 重建', () => {
  it('远端数据被清空后可从 SQLite 完整正文和哈希重建，并持久保存逐项状态', async () => {
    const openViking = new InMemoryOpenViking()
    const service = new ContextSynchronizationApplicationService({
      repository: new SqliteContextIndexRepository(database.getClient()),
      openViking,
      identifiers: new SequentialIdentifierGenerator(),
      clock: new IncrementingClock(),
    })

    const first = await service.reindex()
    expect(first).toMatchObject({ provider: 'openviking', total: 1, synchronized: 1, failed: 0 })
    expect([...openViking.resources.values()]).toEqual(['第一版正文。'])
    expect(first.records[0]).toMatchObject({ status: 'synchronized', contentHash: 'a'.repeat(64), error: null })
    const recordId = first.records[0]!.id

    openViking.resources.clear()
    database.getClient().prepare(`
      UPDATE source_materials SET content_text = '第二版完整正文。', content_hash = ?, updated_at = 2000 WHERE id = ?
    `).run('b'.repeat(64), '00000000-0000-4000-8000-000000000001')
    const rebuilt = await service.reindex()
    expect(openViking.resetCount).toBe(2)
    expect([...openViking.resources.values()]).toEqual(['第二版完整正文。'])
    expect(rebuilt.records[0]).toMatchObject({ id: recordId, status: 'synchronized', contentHash: 'b'.repeat(64) })
  })

  it('能力关闭时拒绝重建且不删除远端数据', async () => {
    const openViking = new InMemoryOpenViking(false)
    const service = new ContextSynchronizationApplicationService({
      repository: new SqliteContextIndexRepository(database.getClient()),
      openViking,
      identifiers: new SequentialIdentifierGenerator(),
      clock: new IncrementingClock(),
    })

    await expect(service.reindex()).rejects.toMatchObject<ApplicationError>({
      code: 'CAPABILITY_DISABLED', statusCode: 422,
    })
    expect(openViking.resetCount).toBe(0)
  })

  it('能力启用时资料创建和更新只排持久任务并由 Worker 同步最新正文', async () => {
    database.getClient().prepare('DELETE FROM source_materials').run()
    const identifiers = new SequentialIdentifierGenerator()
    const clock = new IncrementingClock()
    const openViking = new InMemoryOpenViking()
    const contextService = new ContextSynchronizationApplicationService({
      repository: new SqliteContextIndexRepository(database.getClient()),
      openViking,
      identifiers,
      clock,
    })
    const content = new ContentApplicationService({
      repository: new SqliteContentRepository(database.getClient()),
      identifiers,
      clock,
      sourceProcessor: new NodeSourceContentProcessor(identifiers),
      sourceFiles: new LocalSourceFileStorage(temporaryDirectory),
      contextSyncQueue: new SqliteContextSyncTaskQueue(database.getClient()),
    })
    const ignoredHandler = { /** @returns 本测试不应调用该处理器。 */ execute: async () => { throw new Error('路由错误') } }
    const worker = new WorkerApplicationService({
      taskJobRepository: new SqliteTaskJobRepository(database.getClient()),
      taskHandler: new TaskRoutingApplicationService(ignoredHandler, ignoredHandler, contextService),
      clock,
      leaseDurationMs: 60_000,
    })

    const created = await content.createPastedSource({ name: '增量资料', role: 'reference', content: '第一版增量正文。' })
    expect(database.getClient().prepare(`SELECT type, status FROM task_jobs WHERE type = 'sync_context_source'`).all())
      .toEqual([{ type: 'sync_context_source', status: 'queued' }])
    expect(openViking.resources.size).toBe(0)

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    expect([...openViking.resources.values()]).toContain('第一版增量正文。')
    await content.updateSource(created.source.id, { name: '增量资料', role: 'reference', content: '第二版增量正文。' })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    expect(openViking.resources.get(`viking://resources/ren-yang/${created.source.id}.md`)).toBe('第二版增量正文。')
  })

  it('能力关闭时资料保存不创建 OpenViking 同步任务', async () => {
    database.getClient().prepare('DELETE FROM source_materials').run()
    const identifiers = new SequentialIdentifierGenerator()
    const content = new ContentApplicationService({
      repository: new SqliteContentRepository(database.getClient()),
      identifiers,
      clock: new IncrementingClock(),
      sourceProcessor: new NodeSourceContentProcessor(identifiers),
      sourceFiles: new LocalSourceFileStorage(temporaryDirectory),
    })

    await content.createPastedSource({ name: '本地资料', role: 'reference', content: '只保存到 SQLite。' })
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM task_jobs WHERE type = 'sync_context_source'`).get())
      .toEqual({ count: 0 })
  })
})
