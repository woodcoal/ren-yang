import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { SqliteContextSyncTaskQueue } from '../../server/infrastructure/database/SqliteContextSyncTaskQueue'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteTaskJobRepository } from '../../server/infrastructure/database/SqliteTaskJobRepository'

let directory: string
let database: SqliteDatabase

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-openviking-outbox-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('OpenViking 专属同步意图', () => {
  it('OpenViking 意图不进入业务任务表且与业务 Worker 独立领取', async () => {
    const client = database.getClient()
    const outbox = new SqliteContextSyncTaskQueue(client)
    await outbox.enqueueSourceSynchronization('source-1', 'openviking-source-job', 1_000)
    client.prepare(`
      INSERT INTO task_jobs (
        id, run_id, type, payload_json, status, attempt_count, max_attempts,
        available_at, created_at, updated_at
      ) VALUES ('foreground-job', NULL, 'analyze_learning', '{}', 'queued', 0, 2, 0, 2_000, 2_000)
    `).run()

    expect(client.prepare(`SELECT COUNT(*) AS count FROM task_jobs WHERE type LIKE 'sync_%'`).get()).toEqual({ count: 0 })
    await expect(new SqliteTaskJobRepository(client).claimNext(3_000, 60_000)).resolves.toMatchObject({
      id: 'foreground-job', type: 'analyze_learning',
    })
    await expect(outbox.claimNext(3_000, 60_000)).resolves.toMatchObject({
      id: 'openviking-source-job', type: 'sync_context_source', attemptCount: 1,
    })
  })

  it('成功或终止的意图立即移除，可重试失败仅保留下一次送达意图', async () => {
    const client = database.getClient()
    const outbox = new SqliteContextSyncTaskQueue(client)
    await outbox.enqueueUserReconciliation('users-job', 1_000)
    const first = await outbox.claimNext(1_000, 60_000)
    if (!first) throw new Error('测试同步意图未领取')
    await expect(outbox.markFailed(first.id, '瞬时超时', 2_000, true)).resolves.toBe(true)
    expect(client.prepare(`SELECT status, attempt_count, last_error FROM openviking_sync_outbox`).get()).toEqual({
      status: 'queued', attempt_count: 1, last_error: '瞬时超时',
    })

    client.prepare(`UPDATE openviking_sync_outbox SET available_at = 0`).run()
    const second = await outbox.claimNext(3_000, 60_000)
    if (!second) throw new Error('测试重试意图未领取')
    await outbox.markSucceeded(second.id, 4_000)
    expect(client.prepare(`SELECT COUNT(*) AS count FROM openviking_sync_outbox`).get()).toEqual({ count: 0 })

    await outbox.enqueueSessionSynchronization('run', 'run-1', 'session-job', 5_000)
    const terminal = await outbox.claimNext(5_000, 60_000)
    if (!terminal) throw new Error('测试 Session 意图未领取')
    await expect(outbox.markFailed(terminal.id, '输入无效', 6_000, false)).resolves.toBe(false)
    expect(client.prepare(`SELECT COUNT(*) AS count FROM openviking_sync_outbox`).get()).toEqual({ count: 0 })
  })
})
