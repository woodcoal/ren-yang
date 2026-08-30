import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { ContextSynchronizationApplicationService } from '../../server/application/context/ContextSynchronizationApplicationService'
import { ContentApplicationService } from '../../server/application/content/ContentApplicationService'
import { LearningApplicationService } from '../../server/application/learning/LearningApplicationService'
import { TaskRoutingApplicationService } from '../../server/application/tasks/TaskRoutingApplicationService'
import { WorkerApplicationService } from '../../server/application/tasks/WorkerApplicationService'
import { LocalSourceFileStorage } from '../../server/infrastructure/content/LocalSourceFileStorage'
import { NodeSourceContentProcessor } from '../../server/infrastructure/content/NodeSourceContentProcessor'
import { SqliteContentRepository } from '../../server/infrastructure/database/SqliteContentRepository'
import { SqliteContextIndexRepository } from '../../server/infrastructure/database/SqliteContextIndexRepository'
import { SqliteContextSyncTaskQueue } from '../../server/infrastructure/database/SqliteContextSyncTaskQueue'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteLearningRepository } from '../../server/infrastructure/database/SqliteLearningRepository'
import { SqliteContextProvider } from '../../server/infrastructure/context/SqliteContextProvider'
import { SqliteTaskJobRepository } from '../../server/infrastructure/database/SqliteTaskJobRepository'
import type { Clock } from '../../server/ports/Clock'
import type { ContextSourceProjection } from '../../server/ports/ContextIndexRepository'
import type { IdentifierGenerator } from '../../server/ports/IdentifierGenerator'
import { OpenVikingError, type OpenVikingPort } from '../../server/ports/OpenVikingPort'
import { ApplicationError } from '../../server/application/errors/ApplicationError'
import type { DerivedMemoryDocument } from '../../server/ports/ContextIndexRepository'

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
  /** 删除资源前还需模拟的临时失败次数。 */
  public deleteFailuresRemaining = 0
  /** 已成功删除的旧投影身份，用于验证跨 User 迁移。 */
  public readonly deletedProjections: Array<{ userId: string, peerId: string | null, remoteUri: string | null }> = []
  /** Session 提交后返回的固定派生记忆。 */
  public sessionMemories: DerivedMemoryDocument[] = []
  /** 当前模拟 Account 中由应用管理的 User。 */
  public readonly userIds = new Set<string>()

  /** @param enabled 能力开关。 */
  constructor(private readonly enabled = true) {}

  /** @returns 固定能力配置。 */
  getCapability() {
    return { configured: true, enabled: this.enabled, provider: 'openviking' as const, endpointOrigin: 'http://openviking.test' }
  }

  /** @returns 固定健康状态。 */
  async checkHealth() { return { healthy: true, version: 'test', authMode: 'api_key' as const } }

  /** @param userIds SQLite 目标 User。 @returns 模拟创建缺失 User、删除孤立 User 后结束。 */
  async reconcileUsers(userIds: string[]) {
    this.userIds.clear()
    for (const userId of userIds) this.userIds.add(userId)
  }

  /** @param userIds SQLite 目标 User。 @returns 模拟原位清空全部受管 User 内容后结束。 */
  async rebuildUsers(userIds: string[]) {
    await this.reconcileUsers(userIds)
    this.resources.clear()
  }

  /** @returns 清空全部模拟远端资源。 */
  async resetLegacyIndex() {
    this.resetCount += 1
    this.resources.clear()
  }

  /**
   * 删除一项稳定 URI 的模拟远端资料。
   * @param sourceId 已从 SQLite 删除的资料 UUID。
   * @returns 删除内存资源后结束。
   */
  async deleteProjection(record: import('../../shared/types/context').ContextSyncRecordView): Promise<void> {
    if (this.deleteFailuresRemaining > 0) {
      this.deleteFailuresRemaining -= 1
      throw new OpenVikingError('PROVIDER_UNAVAILABLE', '模拟 OpenViking 删除失败')
    }
    this.deletedProjections.push({ userId: record.userId, peerId: record.peerId, remoteUri: record.remoteUri })
    if (record.remoteUri) this.resources.delete(record.remoteUri)
  }

  /** @param projection SQLite 资料投影。 @returns 写入的稳定远端 URI。 */
  async synchronizeProjection(projection: ContextSourceProjection) {
    const uri = projection.remoteUri
    this.resources.set(uri, projection.source.contentText)
    return uri
  }

  /** @returns 当前测试配置的 Session 派生记忆。 */
  async synchronizeSession() { return this.sessionMemories }
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
  database.getClient().prepare(`
    INSERT INTO worlds (id, name, summary, active_soul_version_id, created_at, updated_at)
    VALUES ('00000000-0000-4000-8000-000000000100', '测试世界', '', NULL, 1000, 1000)
  `).run()
  database.getClient().prepare(`
    INSERT INTO world_sources (world_id, source_id, priority)
    VALUES ('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000001', 10)
  `).run()
})

afterEach(() => {
  database.close()
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

describe('OpenViking 可关闭索引与 SQLite 重建', () => {
  it('同一资料关联世界和人物时生成两个隔离投影', async () => {
    database.getClient().prepare(`
      INSERT INTO personas (id, world_id, name, origin, active_soul_version_id, created_at, updated_at)
      VALUES ('00000000-0000-4000-8000-000000000200', '00000000-0000-4000-8000-000000000100', '测试人物', 'original', NULL, 1000, 1000)
    `).run()
    database.getClient().prepare(`
      INSERT INTO persona_sources (persona_id, source_id, priority)
      VALUES ('00000000-0000-4000-8000-000000000200', '00000000-0000-4000-8000-000000000001', 20)
    `).run()
    const openViking = new InMemoryOpenViking()
    const service = new ContextSynchronizationApplicationService({
      repository: new SqliteContextIndexRepository(database.getClient()), openViking,
      identifiers: new SequentialIdentifierGenerator(), clock: new IncrementingClock(),
    })

    await expect(service.reindex()).resolves.toMatchObject({ total: 2, synchronized: 2, failed: 0 })
    expect([...openViking.resources.keys()].sort()).toEqual([
      'viking://~/peers/persona-00000000-0000-4000-8000-000000000200/resources/ren-yang/persona-source/00000000-0000-4000-8000-000000000001.md',
      'viking://~/resources/ren-yang/world-source/00000000-0000-4000-8000-000000000001.md',
    ])
  })

  it('User 对账为世界创建 User，并为无世界人物创建隐藏 User', async () => {
    database.getClient().prepare(`
      INSERT INTO personas (id, world_id, name, origin, active_soul_version_id, created_at, updated_at)
      VALUES ('00000000-0000-4000-8000-000000000200', NULL, '独立人物', 'original', NULL, 1000, 1000)
    `).run()
    const openViking = new InMemoryOpenViking()
    const service = new ContextSynchronizationApplicationService({
      repository: new SqliteContextIndexRepository(database.getClient()), openViking,
      identifiers: new SequentialIdentifierGenerator(), clock: new IncrementingClock(),
    })

    await service.execute({
      id: 'user-sync', type: 'sync_openviking_users', payloadJson: '{}', status: 'running',
      attemptCount: 1, maxAttempts: 3, leaseUntil: 2_000,
    })

    expect([...openViking.userIds].sort()).toEqual([
      'standalone-00000000-0000-4000-8000-000000000200',
      'world-00000000-0000-4000-8000-000000000100',
    ])
  })

  it('人物更换世界时先用旧 User 删除投影，失败后保留旧身份供重试', async () => {
    database.getClient().prepare(`
      INSERT INTO worlds (id, name, summary, active_soul_version_id, created_at, updated_at)
      VALUES ('00000000-0000-4000-8000-000000000101', '新世界', '', NULL, 1000, 1000)
    `).run()
    database.getClient().prepare(`
      INSERT INTO personas (id, world_id, name, origin, active_soul_version_id, created_at, updated_at)
      VALUES ('00000000-0000-4000-8000-000000000200', '00000000-0000-4000-8000-000000000100', '测试人物', 'original', NULL, 1000, 1000)
    `).run()
    database.getClient().prepare(`
      INSERT INTO persona_sources (persona_id, source_id, priority)
      VALUES ('00000000-0000-4000-8000-000000000200', '00000000-0000-4000-8000-000000000001', 20)
    `).run()
    const repository = new SqliteContextIndexRepository(database.getClient())
    const openViking = new InMemoryOpenViking()
    const service = new ContextSynchronizationApplicationService({
      repository,
      openViking,
      identifiers: new SequentialIdentifierGenerator(),
      clock: new IncrementingClock(),
    })
    await service.synchronizeSource('00000000-0000-4000-8000-000000000001')
    openViking.deletedProjections.length = 0
    database.getClient().prepare(`
      UPDATE personas SET world_id = '00000000-0000-4000-8000-000000000101' WHERE id = '00000000-0000-4000-8000-000000000200'
    `).run()

    openViking.deleteFailuresRemaining = 1
    await expect(service.synchronizeSource('00000000-0000-4000-8000-000000000001')).rejects.toMatchObject({ retryable: true })
    expect((await repository.listSyncRecords()).find(record => record.scopeType === 'persona')).toMatchObject({
      userId: 'world-00000000-0000-4000-8000-000000000100',
      status: 'failed',
    })

    await expect(service.synchronizeSource('00000000-0000-4000-8000-000000000001')).resolves.toBeUndefined()
    expect(openViking.deletedProjections).toContainEqual({
      userId: 'world-00000000-0000-4000-8000-000000000100',
      peerId: 'persona-00000000-0000-4000-8000-000000000200',
      remoteUri: 'viking://~/peers/persona-00000000-0000-4000-8000-000000000200/resources/ren-yang/persona-source/00000000-0000-4000-8000-000000000001.md',
    })
    expect((await repository.listSyncRecords()).find(record => record.scopeType === 'persona')).toMatchObject({
      userId: 'world-00000000-0000-4000-8000-000000000101',
      status: 'synchronized',
    })
  })

  it('FTS5 只检索已生效成长和记忆，不暴露候选内容', async () => {
    database.getClient().prepare(`
      INSERT INTO personas (id, world_id, name, origin, active_soul_version_id, created_at, updated_at)
      VALUES ('00000000-0000-4000-8000-000000000200', NULL, '测试人物', 'original', NULL, 1000, 1000)
    `).run()
    const insertMemory = database.getClient().prepare(`
      INSERT INTO memory_records (
        id, persona_id, current_revision_id, memory_type, status, created_at, updated_at
      ) VALUES (?, '00000000-0000-4000-8000-000000000200', ?, 'preference', 'candidate', 1000, 1000)
    `)
    const insertRevision = database.getClient().prepare(`
      INSERT INTO memory_revisions (
        id, memory_id, revision_no, content, content_hash, scope, importance,
        independent_evidence_count, created_by, created_at
      ) VALUES (?, ?, 1, ?, ?, '表达方式', 4, 2, 'user', 1000)
    `)
    insertMemory.run('active-memory', 'active-memory-revision')
    insertRevision.run('active-memory-revision', 'active-memory', '长期偏好使用克制表达', 'c'.repeat(64))
    database.getClient().prepare(`UPDATE memory_records SET status = 'active' WHERE id = 'active-memory'`).run()
    insertMemory.run('candidate-memory', 'candidate-memory-revision')
    insertRevision.run('candidate-memory-revision', 'candidate-memory', '候选偏好使用夸张表达', 'd'.repeat(64))
    const provider = new SqliteContextProvider(database.getClient())

    await expect(provider.search({
      personaId: '00000000-0000-4000-8000-000000000200', worldId: null, query: '长期偏好使用克制表达', limit: 5,
    })).resolves.toMatchObject({ provider: 'sqlite_fts5', candidates: [{ role: 'memory', content: '长期偏好使用克制表达' }] })
    await expect(provider.search({
      personaId: '00000000-0000-4000-8000-000000000200', worldId: null, query: '候选偏好使用夸张表达', limit: 5,
    })).resolves.toEqual({ provider: 'sqlite_fts5', candidates: [] })
  })

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
    expect(openViking.deletedProjections).toEqual([])
    expect([...openViking.resources.values()]).toEqual(['第二版完整正文。'])
    expect(rebuilt.records[0]).toMatchObject({ id: recordId, status: 'synchronized', contentHash: 'b'.repeat(64) })
  })

  it('人物反馈资料投影到 Peer Resource，删除失败时保留本地待删状态并可重试', async () => {
    database.getClient().prepare(`
      INSERT INTO personas (id, world_id, name, origin, active_soul_version_id, created_at, updated_at)
      VALUES ('00000000-0000-4000-8000-000000000200', NULL, '测试人物', 'original', NULL, 1000, 1000)
    `).run()
    const identifiers = new SequentialIdentifierGenerator()
    const clock = new IncrementingClock()
    const queue = new SqliteContextSyncTaskQueue(database.getClient())
    const learning = new LearningApplicationService({
      content: new SqliteContentRepository(database.getClient()),
      learning: new SqliteLearningRepository(database.getClient()),
      identifiers,
      clock,
      contextSyncQueue: queue,
    })
    const openViking = new InMemoryOpenViking()
    const context = new ContextSynchronizationApplicationService({
      repository: new SqliteContextIndexRepository(database.getClient()),
      openViking,
      identifiers,
      clock,
    })

    const feedback = await learning.createPersonaFeedbackSource('00000000-0000-4000-8000-000000000200', {
      title: '表达反馈', content: '回答时先给结论。', sourceType: 'manual', sourceId: null,
    })
    await context.synchronizeProjectionEntity('persona_feedback_source', feedback.id)
    const remoteUri = `viking://~/peers/persona-00000000-0000-4000-8000-000000000200/resources/ren-yang/feedback-source/${feedback.id}.md`
    expect(openViking.resources.get(remoteUri)).toBe('回答时先给结论。')

    await learning.deletePersonaFeedbackSources('00000000-0000-4000-8000-000000000200', { ids: [feedback.id] })
    expect(database.getClient().prepare(`SELECT deletion_state FROM persona_feedback_sources WHERE id = ?`).get(feedback.id))
      .toEqual({ deletion_state: 'pending_remote_delete' })
    openViking.deleteFailuresRemaining = 1
    await expect(context.synchronizeProjectionEntity('persona_feedback_source', feedback.id)).rejects.toMatchObject({ retryable: true })
    expect(database.getClient().prepare(`SELECT content FROM persona_feedback_sources WHERE id = ?`).get(feedback.id))
      .toEqual({ content: '回答时先给结论。' })

    await expect(context.synchronizeProjectionEntity('persona_feedback_source', feedback.id)).resolves.toBeUndefined()
    expect(database.getClient().prepare(`SELECT id FROM persona_feedback_sources WHERE id = ?`).get(feedback.id)).toBeUndefined()
    expect(openViking.resources.has(remoteUri)).toBe(false)
  })

  it('人物处理记录写入 Peer Session 后只保存为记忆分析素材', async () => {
    const personaId = '00000000-0000-4000-8000-000000000200'
    const versionId = '00000000-0000-4000-8000-000000000201'
    const runId = '00000000-0000-4000-8000-000000000202'
    const operationId = '00000000-0000-4000-8000-000000000203'
    database.getClient().prepare(`
      INSERT INTO personas (id, world_id, name, origin, active_soul_version_id, created_at, updated_at)
      VALUES (?, NULL, '测试人物', 'original', ?, 1000, 1000)
    `).run(personaId, versionId)
    database.getClient().prepare(`
      INSERT INTO soul_versions (
        id, subject_type, world_id, persona_id, chapters_json, runtime_summary,
        runtime_token_count, token_counter, change_summary, status, published_at, created_at
      ) VALUES (?, 'persona', NULL, ?, '[]', '测试人物', 4, 'test', '建立人物', 'published', 1000, 1000)
    `).run(versionId, personaId)
    database.getClient().prepare(`
      INSERT INTO generation_runs (
        id, kind, persona_version_id, status, input_json, parameter_snapshot_json,
        model_snapshot_json, prompt_version, context_provider, result_json, created_at, updated_at, completed_at
      ) VALUES (?, 'interest_assessment', ?, 'succeeded', '{"content":"判断这篇文章"}', '{}', '{}', 'test', 'sqlite_fts5', '{"interested":true}', 1000, 1000, 1000)
    `).run(runId, versionId)
    database.getClient().prepare(`
      INSERT INTO persona_operation_records (
        id, persona_id, run_id, operation_type, result_summary, is_enabled,
        context_snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'interest_assessment', '对事实型文章感兴趣。', 1, '{}', 1000, 1000)
    `).run(operationId, personaId, runId)
    const openViking = new InMemoryOpenViking()
    openViking.sessionMemories = [{
      remoteUri: `viking://~/peers/persona-${personaId}/memories/events/event-1.md`,
      memoryType: 'events', content: '多次选择事实型文章。', contentHash: 'e'.repeat(64),
    }]
    const context = new ContextSynchronizationApplicationService({
      repository: new SqliteContextIndexRepository(database.getClient()),
      openViking,
      identifiers: new SequentialIdentifierGenerator(),
      clock: new IncrementingClock(),
      taskQueue: new SqliteContextSyncTaskQueue(database.getClient()),
    })

    await context.synchronizeSession('run', runId)

    expect(database.getClient().prepare(`
      SELECT persona_id, memory_type, content, is_enabled FROM openviking_derived_memories
    `).all()).toEqual([{ persona_id: personaId, memory_type: 'events', content: '多次选择事实型文章。', is_enabled: 1 }])
    expect(database.getClient().prepare(`SELECT session_record_id FROM persona_operation_records WHERE id = ?`).get(operationId))
      .toEqual({ session_record_id: `ren-yang-run-${runId}` })
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM memory_records`).get()).toEqual({ count: 0 })

    await context.reindex()

    expect(database.getClient().prepare(`SELECT status FROM openviking_session_records WHERE source_id = ?`).get(runId))
      .toEqual({ status: 'pending' })
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM openviking_derived_memories`).get())
      .toEqual({ count: 1 })
    expect(database.getClient().prepare(`
      SELECT type, status FROM task_jobs
      WHERE type = 'sync_openviking_session' AND json_extract(payload_json, '$.sourceId') = ?
    `).get(runId)).toEqual({ type: 'sync_openviking_session', status: 'queued' })
  })

  it('启动补偿会从 SQLite 补回缺失任务并保持重复扫描幂等', async () => {
    const taskQueue = new SqliteContextSyncTaskQueue(database.getClient())
    const service = new ContextSynchronizationApplicationService({
      repository: new SqliteContextIndexRepository(database.getClient()),
      openViking: new InMemoryOpenViking(),
      identifiers: new SequentialIdentifierGenerator(),
      clock: new IncrementingClock(),
      taskQueue,
    })

    await service.recoverPendingTasks()
    await service.recoverPendingTasks()

    expect(database.getClient().prepare(`
      SELECT COUNT(*) AS count FROM task_jobs WHERE type = 'sync_openviking_users' AND status = 'queued'
    `).get()).toEqual({ count: 1 })

    expect(database.getClient().prepare(`
      SELECT type, status, json_extract(payload_json, '$.sourceId') AS source_id
      FROM task_jobs WHERE type = 'sync_context_source'
    `).all()).toEqual([{
      type: 'sync_context_source',
      status: 'queued',
      source_id: '00000000-0000-4000-8000-000000000001',
    }])
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

  it('能力启用时资料创建、更新和删除均排持久任务，并由 Worker 同步和重试', async () => {
    database.getClient().prepare('DELETE FROM world_sources').run()
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
      taskHandler: new TaskRoutingApplicationService(ignoredHandler, contextService),
      clock,
      leaseDurationMs: 60_000,
    })

    const created = await content.createPastedSource({ name: '增量资料', role: 'reference', content: '第一版增量正文。' })
    await content.linkSource(created.source.id, {
      targetType: 'world', targetId: '00000000-0000-4000-8000-000000000100', priority: 10,
    })
    expect(database.getClient().prepare(`SELECT type, status FROM task_jobs WHERE type = 'sync_context_source'`).all())
      .toHaveLength(1)
    expect(openViking.resources.size).toBe(0)

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    expect([...openViking.resources.values()]).toContain('第一版增量正文。')
    await content.updateSource(created.source.id, { name: '增量资料', role: 'reference', content: '第二版增量正文。' })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    expect(openViking.resources.get(`viking://~/resources/ren-yang/world-source/${created.source.id}.md`)).toBe('第二版增量正文。')

    await content.updateSourcesStatus({ sourceIds: [created.source.id], isEnabled: false })
    const disabled = await content.getSource(created.source.id)
    expect(disabled).toMatchObject({ source: { isEnabled: false, contentText: '第二版增量正文。' }, links: [{ targetType: 'world' }] })
    await expect(new SqliteContextProvider(database.getClient()).search({
      personaId: '无人物', worldId: '00000000-0000-4000-8000-000000000100', query: '第二版增量正文', limit: 5,
    })).resolves.toEqual({ provider: 'sqlite_fts5', candidates: [] })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    expect(openViking.resources.has(`viking://~/resources/ren-yang/world-source/${created.source.id}.md`)).toBe(false)
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM context_sync_records').get()).toEqual({ count: 0 })

    await content.updateSourceStatus(created.source.id, { isEnabled: true })
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    expect(openViking.resources.get(`viking://~/resources/ren-yang/world-source/${created.source.id}.md`)).toBe('第二版增量正文。')

    await content.unlinkSource(created.source.id, 'world:00000000-0000-4000-8000-000000000100')
    openViking.deleteFailuresRemaining = 1
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: false })
    expect(database.getClient().prepare(`
      SELECT status, attempt_count FROM task_jobs WHERE type = 'sync_context_source' AND status = 'queued'
    `).get()).toEqual({ status: 'queued', attempt_count: 1 })
    expect(openViking.resources.has(`viking://~/resources/ren-yang/world-source/${created.source.id}.md`)).toBe(true)

    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
    expect(openViking.resources.has(`viking://~/resources/ren-yang/world-source/${created.source.id}.md`)).toBe(false)
    expect(database.getClient().prepare('SELECT COUNT(*) AS count FROM context_sync_records').get()).toEqual({ count: 0 })

    await content.deleteSource(created.source.id)
    await expect(worker.executeNext()).resolves.toMatchObject({ handled: true, succeeded: true })
  })

  it('能力关闭时资料保存不创建 OpenViking 同步任务', async () => {
    database.getClient().prepare('DELETE FROM world_sources').run()
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
