import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteTaskJobRepository } from '../../server/infrastructure/database/SqliteTaskJobRepository'

let directory: string
let database: SqliteDatabase

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-worker-lanes-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('任务队列双通道领取', () => {
  it('前台与 OpenViking 通道只领取各自任务且互不占用', async () => {
    const insert = database.getClient().prepare(`
      INSERT INTO task_jobs (
        id, run_id, type, payload_json, status, attempt_count, max_attempts,
        available_at, created_at, updated_at
      ) VALUES (?, NULL, ?, '{}', 'queued', 0, 2, 0, ?, ?)
    `)
    insert.run('openviking-source-job', 'sync_context_source', 1_000, 1_000)
    insert.run('openviking-users-job', 'sync_openviking_users', 1_100, 1_100)
    insert.run('openviking-session-job', 'sync_openviking_session', 1_200, 1_200)
    insert.run('foreground-job', 'analyze_learning', 2_000, 2_000)
    const repository = new SqliteTaskJobRepository(database.getClient())

    await expect(repository.claimNext(3_000, 60_000, 'foreground')).resolves.toMatchObject({
      id: 'foreground-job', type: 'analyze_learning',
    })
    await expect(repository.claimNext(3_000, 60_000, 'openviking')).resolves.toMatchObject({
      id: 'openviking-source-job', type: 'sync_context_source',
    })
    await expect(repository.claimNext(3_000, 60_000, 'openviking')).resolves.toMatchObject({
      id: 'openviking-users-job', type: 'sync_openviking_users',
    })
    await expect(repository.claimNext(3_000, 60_000, 'openviking')).resolves.toMatchObject({
      id: 'openviking-session-job', type: 'sync_openviking_session',
    })
  })
})
