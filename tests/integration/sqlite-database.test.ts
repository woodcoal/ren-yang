import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
      WHERE type = 'table' AND name IN ('administrators', 'openviking_sync_runtime', 'task_jobs')
      ORDER BY name
    `).all()
    expect(tables).toEqual([
      { name: 'administrators' },
      { name: 'openviking_sync_runtime' },
      { name: 'task_jobs' },
    ])
    expect(current.getClient().prepare(`
      SELECT COUNT(*) AS count, MAX(created_at) AS version FROM __drizzle_migrations
    `).get()).toEqual({ count: 4, version: 1789372800000 })
    expect(current.getClient().prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
      'api_keys', 'public_api_idempotency_records', 'public_api_audit_events'
    ) ORDER BY name`).all()).toEqual([
      { name: 'api_keys' },
      { name: 'public_api_audit_events' },
      { name: 'public_api_idempotency_records' },
    ])
    expect(current.getClient().prepare(`
      SELECT COUNT(*) AS count FROM ai_prompts WHERE active_version_id IS NOT NULL
    `).get()).toEqual({ count: 22 })
    expect(current.getClient().prepare(`SELECT COUNT(*) AS count FROM ai_prompt_versions`).get()).toEqual({ count: 22 })
    expect(current.getClient().prepare(`SELECT COUNT(*) AS count FROM ai_algorithms`).get()).toEqual({ count: 5 })
    expect(current.getClient().prepare(`SELECT code FROM ai_algorithms WHERE code = 'persona_memory'`).get()).toEqual({ code: 'persona_memory' })
    expect(current.getClient().prepare(`PRAGMA table_info(ai_connections)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'user_agent', notnull: 1, dflt_value: "''" }),
    ]))
    expect(current.getClient().prepare(`PRAGMA table_info(openviking_settings)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'api_key_ciphertext', notnull: 1, dflt_value: "''" }),
    ]))
    expect(current.getClient().prepare(`PRAGMA table_info(source_materials)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'is_enabled', notnull: 1, dflt_value: '1' }),
    ]))
    expect(current.getClient().prepare(`PRAGMA table_info(personas)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'is_enabled', notnull: 1, dflt_value: '1' }),
    ]))
    expect(current.getClient().prepare(`PRAGMA table_info(worlds)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'is_enabled', notnull: 1, dflt_value: '1' }),
    ]))
    expect(current.getClient().prepare(`
      SELECT name FROM sqlite_master
      WHERE sql LIKE 'CREATE VIRTUAL TABLE%' OR type = 'trigger'
      ORDER BY name
    `).all()).toEqual([
      { name: 'generation_runs_task_jobs_delete' },
      { name: 'growth_records_learning_fts_delete' },
      { name: 'growth_records_learning_fts_insert' },
      { name: 'growth_records_learning_fts_update' },
      { name: 'learning_fts' },
      { name: 'memory_records_learning_fts_delete' },
      { name: 'memory_records_learning_fts_insert' },
      { name: 'memory_records_learning_fts_update' },
      { name: 'source_chunks_fts' },
      { name: 'source_chunks_fts_delete' },
      { name: 'source_chunks_fts_insert' },
      { name: 'source_chunks_fts_update' },
      { name: 'task_jobs_run_insert_check' },
      { name: 'task_jobs_run_update_check' },
    ])
  })

  it('已完成压平前最终迁移的旧数据库不会重复执行新基线', () => {
    temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-sqlite-legacy-test-'))
    const dataDirectory = resolve(temporaryDirectory, 'data')
    const migrationsDirectory = resolve(temporaryDirectory, 'migrations')
    mkdirSync(resolve(migrationsDirectory, 'meta'), { recursive: true })
    copyFileSync(resolve(process.cwd(), 'drizzle', '0000_schema.sql'), resolve(migrationsDirectory, '0000_schema.sql'))
    writeFileSync(resolve(migrationsDirectory, 'meta', '_journal.json'), `${JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [{
        idx: 0,
        version: '6',
        when: 1789113600000,
        tag: '0000_schema',
        breakpoints: true,
      }],
    }, null, 2)}\n`)
    database = new SqliteDatabase({ dataDirectory, migrationsDirectory })
    const current = database
    const client = current.getClient()
    client.prepare(`
      INSERT INTO source_materials (
        id, name, role, input_type, content_hash, content_text, original_file_path, created_at, updated_at
      ) VALUES ('source-1', '旧资料', 'reference', 'paste', ?, '压平前正文。', NULL, 1000, 1000)
    `).run('a'.repeat(64))
    client.prepare(`
      INSERT INTO context_sync_records (
        id, entity_type, source_id, scope_type, scope_id, user_id, provider,
        content_hash, status, operation, error, created_at, updated_at
      ) VALUES (
        'sync-1', 'source_material', 'source-1', 'persona', 'persona-1', 'user-1', 'openviking',
        ?, 'failed', 'upsert', '旧同步错误', 1000, 1000
      )
    `).run('b'.repeat(64))
    // 以当前真实表结构配合十六条历史记录，模拟从最早迁移链升级到 0006 的现有数据库。
    client.prepare(`DELETE FROM __drizzle_migrations`).run()
    const insertMigration = client.prepare(`
      INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)
    `)
    const versions = [
      1788028900254,
      1788036380272,
      1788042164727,
      1788075317577,
      1788081200000,
      1788084800000,
      1788163200000,
      1788249600000,
      1788336000000,
      1788422400000,
      1788508800000,
      1788768000000,
      1788854400000,
      1788940800000,
      1789027200000,
      1789113600000,
    ]
    versions.forEach((version, index) => insertMigration.run(`legacy-${index}`, version))
    current.close()
    database = null

    database = new SqliteDatabase({
      dataDirectory,
      migrationsDirectory: resolve(process.cwd(), 'drizzle'),
    })
    expect(database.getClient().prepare(`
      SELECT name, content_text, is_enabled FROM source_materials WHERE id = 'source-1'
    `).get()).toEqual({ name: '旧资料', content_text: '压平前正文。', is_enabled: 1 })
    expect(database.getClient().prepare(`
      SELECT COUNT(*) AS count, MAX(created_at) AS version FROM __drizzle_migrations
    `).get()).toEqual({ count: 19, version: 1789372800000 })
    expect(database.getClient().prepare(`SELECT COUNT(*) AS count FROM ai_algorithms`).get()).toEqual({ count: 5 })
    expect(database.getClient().prepare(`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'openviking_sync_runtime'`).get()).toEqual({ name: 'openviking_sync_runtime' })
    expect(database.getClient().prepare(`
      SELECT error, error_code, error_stage, failure_count, next_retry_at
      FROM context_sync_records WHERE id = 'sync-1'
    `).get()).toEqual({
      error: '旧同步错误',
      error_code: null,
      error_stage: null,
      failure_count: 0,
      next_retry_at: null,
    })
    expect(database.getClient().prepare(`PRAGMA table_info(ai_connections)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'user_agent', notnull: 1, dflt_value: "''" }),
    ]))
    expect(database.getClient().prepare(`PRAGMA table_info(openviking_settings)`).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'api_key_ciphertext', notnull: 1, dflt_value: "''" }),
    ]))
    expect(database.getClient().prepare('PRAGMA foreign_key_check').all()).toEqual([])
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

  it('任务队列摘要只统计仍需 Worker 处理的任务', async () => {
    const current = createDatabase()
    const client = current.getClient()
    const insert = client.prepare(`
      INSERT INTO task_jobs (id, type, payload_json, status, attempt_count, max_attempts, created_at, updated_at)
      VALUES (?, ?, '{}', ?, 0, 2, 1_000, 1_000)
    `)
    insert.run('queued-job', 'assess_interest', 'queued')
    insert.run('internal-queued-job', 'sync_context_source', 'queued')
    insert.run('running-job', 'assess_interest', 'running')
    insert.run('cancel-requested-job', 'assess_interest', 'cancel_requested')
    insert.run('succeeded-job', 'assess_interest', 'succeeded')
    insert.run('failed-job', 'assess_interest', 'failed')

    await expect(new SqliteTaskJobRepository(client).getPendingSummary()).resolves.toEqual({
      userQueued: 1,
      queued: 2,
      running: 1,
      cancelRequested: 1,
      total: 4,
    })
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

  it('执行失败时只在可重试且尚有次数时重新排队', async () => {
    const current = createDatabase()
    const client = current.getClient()
    client.prepare(`
      INSERT INTO task_jobs (id, type, status, attempt_count, max_attempts, created_at, updated_at)
      VALUES ('job-retry', 'test', 'queued', 0, 2, 500, 500)
    `).run()
    const repository = new SqliteTaskJobRepository(client)

    await repository.claimNext(1_000, 100)
    await expect(repository.markFailed('job-retry', '临时失败', 1_001, true)).resolves.toBe(true)
    expect(client.prepare(`SELECT status, attempt_count FROM task_jobs WHERE id = 'job-retry'`).get())
      .toEqual({ status: 'queued', attempt_count: 1 })

    await repository.claimNext(2_000, 100)
    await expect(repository.markFailed('job-retry', '再次失败', 2_001, true)).resolves.toBe(false)
    expect(client.prepare(`SELECT status, attempt_count FROM task_jobs WHERE id = 'job-retry'`).get())
      .toEqual({ status: 'failed', attempt_count: 2 })
  })

})
