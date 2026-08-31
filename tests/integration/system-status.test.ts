import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SystemApplicationService } from '../../server/application/system/SystemApplicationService'
import { DrizzleAdministratorRepository } from '../../server/infrastructure/database/DrizzleAdministratorRepository'
import { SqliteAuditRepository } from '../../server/infrastructure/database/SqliteAuditRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteTaskJobRepository } from '../../server/infrastructure/database/SqliteTaskJobRepository'
import type { WorkerStatusReader } from '../../server/ports/TaskPorts'

/** 当前测试独占的数据目录。 */
let directory: string
/** 当前测试的真实 SQLite 数据库。 */
let database: SqliteDatabase

beforeEach(() => {
  directory = mkdtempSync(resolve(tmpdir(), 'ren-yang-system-status-test-'))
  database = new SqliteDatabase({ dataDirectory: directory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('系统状态', () => {
  it('返回 Worker 实时状态和持久任务队列数量', async () => {
    const client = database.getClient()
    const insert = client.prepare(`
      INSERT INTO task_jobs (id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
      VALUES (?, 'assess_interest', '{}', ?, 0, 2, 1_000, 1_000)
    `)
    insert.run('queued-job', 'queued')
    insert.run('running-job', 'running')
    insert.run('completed-job', 'succeeded')
    const workerStatus: WorkerStatusReader = {
      /** @returns 固定的进程内 Worker 状态。 */
      getStatus: () => ({ running: true, activeJobId: 'running-job', lastPollAt: 2_000, lastError: null }),
    }
    const service = new SystemApplicationService({
      administratorRepository: new DrizzleAdministratorRepository(database.db),
      databaseHealth: database,
      workerStatus,
      taskQueue: new SqliteTaskJobRepository(client),
      audit: new SqliteAuditRepository(client),
    })

    await expect(service.getHealth()).resolves.toMatchObject({
      healthy: true,
      setupRequired: true,
      worker: { activeJobId: 'running-job' },
      taskQueue: { userQueued: 1, queued: 1, running: 1, cancelRequested: 0, total: 2 },
    })
  })
})
