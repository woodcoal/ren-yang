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
      WHERE type = 'table' AND name IN ('administrators', 'task_jobs')
      ORDER BY name
    `).all()
    expect(tables).toEqual([{ name: 'administrators' }, { name: 'task_jobs' }])
    expect(current.getClient().prepare(`SELECT COUNT(*) AS count FROM __drizzle_migrations`).get()).toEqual({ count: 4 })
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

  it('增量迁移保留旧资料并把原有数据设为启用', () => {
    temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-sqlite-upgrade-test-'))
    const oldMigrationsDirectory = resolve(temporaryDirectory, 'old-drizzle')
    mkdirSync(resolve(oldMigrationsDirectory, 'meta'), { recursive: true })
    copyFileSync(resolve(process.cwd(), 'drizzle/0000_baseline.sql'), resolve(oldMigrationsDirectory, '0000_baseline.sql'))
    writeFileSync(resolve(oldMigrationsDirectory, 'meta/_journal.json'), JSON.stringify({
      version: '7',
      dialect: 'sqlite',
      entries: [{ idx: 0, version: '6', when: 1788028900254, tag: '0000_baseline', breakpoints: true }],
    }))

    database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: oldMigrationsDirectory })
    database.getClient().prepare(`
      INSERT INTO source_materials (
        id, name, role, input_type, content_hash, content_text, original_file_path, created_at, updated_at
      ) VALUES ('source-1', '旧资料', 'reference', 'paste', ?, '迁移前正文。', NULL, 1000, 1000)
    `).run('a'.repeat(64))
    database.close()

    database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
    expect(database.getClient().prepare(`
      SELECT name, content_text, is_enabled FROM source_materials WHERE id = 'source-1'
    `).get()).toEqual({ name: '旧资料', content_text: '迁移前正文。', is_enabled: 1 })
    expect(database.getClient().prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('人物与世界状态迁移保留旧对象和关联并默认启用', () => {
    temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-subject-status-upgrade-test-'))
    const oldMigrationsDirectory = resolve(temporaryDirectory, 'old-drizzle')
    mkdirSync(resolve(oldMigrationsDirectory, 'meta'), { recursive: true })
    copyFileSync(resolve(process.cwd(), 'drizzle/0000_baseline.sql'), resolve(oldMigrationsDirectory, '0000_baseline.sql'))
    copyFileSync(resolve(process.cwd(), 'drizzle/0001_source_material_status.sql'), resolve(oldMigrationsDirectory, '0001_source_material_status.sql'))
    writeFileSync(resolve(oldMigrationsDirectory, 'meta/_journal.json'), JSON.stringify({
      version: '7', dialect: 'sqlite', entries: [
        { idx: 0, version: '6', when: 1788028900254, tag: '0000_baseline', breakpoints: true },
        { idx: 1, version: '6', when: 1788036380272, tag: '0001_source_material_status', breakpoints: true },
      ],
    }))

    database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: oldMigrationsDirectory })
    database.getClient().prepare(`
      INSERT INTO worlds (id, name, summary, created_at, updated_at)
      VALUES ('world-1', '旧世界', '迁移前世界', 1000, 1000)
    `).run()
    database.getClient().prepare(`
      INSERT INTO personas (id, world_id, name, origin, created_at, updated_at)
      VALUES ('persona-1', 'world-1', '旧人物', 'original', 1000, 1000)
    `).run()
    database.close()

    database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
    expect(database.getClient().prepare('SELECT name, world_id, is_enabled FROM personas').get()).toEqual({
      name: '旧人物', world_id: 'world-1', is_enabled: 1,
    })
    expect(database.getClient().prepare('SELECT name, is_enabled FROM worlds').get()).toEqual({
      name: '旧世界', is_enabled: 1,
    })
    expect(database.getClient().prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('灵魂单文本迁移保留旧运行摘要并移除旧结构字段', () => {
    temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'ren-yang-soul-prompt-upgrade-test-'))
    const oldMigrationsDirectory = resolve(temporaryDirectory, 'old-drizzle')
    mkdirSync(resolve(oldMigrationsDirectory, 'meta'), { recursive: true })
    for (const migration of ['0000_baseline.sql', '0001_source_material_status.sql', '0002_persona_world_status.sql']) {
      copyFileSync(resolve(process.cwd(), `drizzle/${migration}`), resolve(oldMigrationsDirectory, migration))
    }
    writeFileSync(resolve(oldMigrationsDirectory, 'meta/_journal.json'), JSON.stringify({
      version: '7', dialect: 'sqlite', entries: [
        { idx: 0, version: '6', when: 1788028900254, tag: '0000_baseline', breakpoints: true },
        { idx: 1, version: '6', when: 1788036380272, tag: '0001_source_material_status', breakpoints: true },
        { idx: 2, version: '6', when: 1788042164727, tag: '0002_persona_world_status', breakpoints: true },
      ],
    }))

    database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: oldMigrationsDirectory })
    database.getClient().prepare(`
      INSERT INTO worlds (id, name, summary, active_soul_version_id, created_at, updated_at)
      VALUES ('world-1', '旧世界', '迁移前世界', 'version-1', 1000, 1000)
    `).run()
    database.getClient().prepare(`
      INSERT INTO soul_versions (
        id, subject_type, world_id, persona_id, parent_version_id, chapters_json, runtime_summary,
        runtime_token_count, token_counter, change_summary, status, published_at, created_at
      ) VALUES ('version-1', 'world', 'world-1', NULL, NULL, '[{"id":"chapter-1"}]', '旧世界发布提示词。',
        8, 'test', '旧发布版本', 'published', 1000, 1000)
    `).run()
    database.getClient().prepare(`
      INSERT INTO soul_drafts (
        id, subject_type, world_id, persona_id, base_version_id, chapters_json, runtime_summary,
        change_summary, created_at, updated_at
      ) VALUES ('draft-1', 'world', 'world-1', NULL, 'version-1', '[{"id":"chapter-2"}]',
        '旧世界草稿提示词。', '旧修改稿', 2000, 2000)
    `).run()
    database.close()

    database = new SqliteDatabase({ dataDirectory: temporaryDirectory, migrationsDirectory: resolve(process.cwd(), 'drizzle') })
    expect(database.getClient().prepare('SELECT prompt_text FROM soul_versions WHERE id = ?').get('version-1')).toEqual({
      prompt_text: '旧世界发布提示词。',
    })
    expect(database.getClient().prepare('SELECT prompt_text FROM soul_drafts WHERE id = ?').get('draft-1')).toEqual({
      prompt_text: '旧世界草稿提示词。',
    })
    for (const table of ['soul_versions', 'soul_drafts']) {
      const columns = database.getClient().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      expect(columns.map(column => column.name)).toContain('prompt_text')
      expect(columns.map(column => column.name)).not.toContain('chapters_json')
      expect(columns.map(column => column.name)).not.toContain('runtime_summary')
    }
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
      VALUES (?, 'test', '{}', ?, 0, 2, 1_000, 1_000)
    `)
    insert.run('queued-job', 'queued')
    insert.run('running-job', 'running')
    insert.run('cancel-requested-job', 'cancel_requested')
    insert.run('succeeded-job', 'succeeded')
    insert.run('failed-job', 'failed')

    await expect(new SqliteTaskJobRepository(client).getPendingSummary()).resolves.toEqual({
      queued: 1,
      running: 1,
      cancelRequested: 1,
      total: 3,
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
