import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { DrizzleAdministratorRepository } from '../../server/infrastructure/database/DrizzleAdministratorRepository'
import { SqliteDatabase } from '../../server/infrastructure/database/SqliteDatabase'
import { SqliteTaskJobRepository } from '../../server/infrastructure/database/SqliteTaskJobRepository'

/** 每个测试创建的数据目录，结束后只清理自身目录。 */
let temporaryDirectory: string | null = null
/** 当前测试打开的数据库。 */
let database: SqliteDatabase | null = null

/**
 * 创建迁移完成的独立 SQLite 数据库。
 * @returns 已初始化数据库。
 */
function createDatabase(): SqliteDatabase {
  temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-sqlite-test-'))
  database = new SqliteDatabase({
    dataDirectory: temporaryDirectory,
    migrationsDirectory: resolve(process.cwd(), 'drizzle'),
  })
  return database
}

afterEach(() => {
  database?.close()
  database = null
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true })
    temporaryDirectory = null
  }
})

describe('SqliteDatabase', () => {
  it('从空目录迁移并启用 WAL、外键和完整性检查', async () => {
    const current = createDatabase()

    await expect(current.check()).resolves.toMatchObject({
      healthy: true,
      journalMode: 'wal',
      foreignKeysEnabled: true,
      integrity: 'ok',
    })

    const tables = current.getClient().prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('administrators', 'task_jobs')
      ORDER BY name
    `).all()
    expect(tables).toEqual([{ name: 'administrators' }, { name: 'task_jobs' }])
  })

  it('数据库唯一约束阻止创建第二名管理员', async () => {
    const current = createDatabase()
    const repository = new DrizzleAdministratorRepository(current.db)
    const record = {
      id: 'administrator',
      username: 'admin',
      passwordHash: 'hash',
      credentialVersion: 1,
      timestamp: 1_000,
    }

    await expect(repository.createIfAbsent(record)).resolves.toBe(true)
    await expect(repository.createIfAbsent(record)).resolves.toBe(false)
    await expect(repository.updatePassword('administrator', 'new-hash', 2_000)).resolves.toMatchObject({
      credentialVersion: 2,
      passwordHash: 'new-hash',
      updatedAt: 2_000,
    })
  })

  it('原子领取任务并增加尝试次数和租约', async () => {
    const current = createDatabase()
    const client = current.getClient()
    client.prepare(`
      INSERT INTO task_jobs (id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', 0, 2, ?, ?)
    `).run('job-1', 'test', '{}', 1_000, 1_000)
    const repository = new SqliteTaskJobRepository(client)

    await expect(repository.claimNext(2_000, 60_000)).resolves.toMatchObject({
      id: 'job-1',
      status: 'running',
      attemptCount: 1,
      leaseUntil: 62_000,
    })
    await expect(repository.claimNext(2_000, 60_000)).resolves.toBeNull()
  })

  it('按最大尝试次数恢复或终止过期租约', async () => {
    const current = createDatabase()
    const client = current.getClient()
    const insert = client.prepare(`
      INSERT INTO task_jobs (
        id, type, status, attempt_count, max_attempts, lease_until, heartbeat_at, created_at, updated_at
      ) VALUES (?, 'test', 'running', ?, 2, 1_000, 900, 500, 900)
    `)
    insert.run('retry-job', 1)
    insert.run('failed-job', 2)
    const repository = new SqliteTaskJobRepository(client)

    await expect(repository.recoverExpired(2_000)).resolves.toBe(2)
    expect(client.prepare('SELECT id, status FROM task_jobs ORDER BY id').all()).toEqual([
      { id: 'failed-job', status: 'failed' },
      { id: 'retry-job', status: 'queued' },
    ])
  })
})
